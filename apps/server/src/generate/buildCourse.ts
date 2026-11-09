/**
 * Build a course from sources: digest (if large) → outline → items per topic → validate.
 *
 * Every model call streams and reads the final message, uses adaptive thinking with the
 * caller's effort, and asks for JSON through output_config.format. The system prompts are
 * read from promptsDir on every build so the learner can edit them, and are sent with a
 * cache breakpoint; the first item call runs alone so the rest read the cached prefix.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildCourseRequest, Course, Item, ItemType, Source, SourceChunk, Topic, Usage } from "@mastery/shared";
import { DIGEST_SCHEMA, ITEMS_SCHEMA, OUTLINE_SCHEMA } from "./schemas.js";
import type { DigestOut, ItemOut, ItemsOut, OutlineOut } from "./schemas.js";
import { addUsage, emptyUsage } from "./usage.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Depth = BuildCourseRequest["depth"];

export interface BuildDeps {
  client: Anthropic;
  /** e.g. "claude-opus-5-5" */
  model: string;
  effort: Effort;
  /** Absolute path to the prompts/ directory. The .md files are read at call time. */
  promptsDir: string;
  readSource(id: string): Promise<{ source: Source; chunks: SourceChunk[] }>;
  /** Progress 0–1. Messages are shown live to the learner: present tense, concrete. */
  onEvent(message: string, progress: number): void;
  newId(prefix: string): string;
  signal?: AbortSignal;
}

export const TOPIC_CAP: Record<Depth, number> = { light: 6, standard: 10, deep: 16 };
export const ITEMS_PER_TOPIC: Record<Depth, number> = { light: 3, standard: 5, deep: 8 };
/** Per-topic mix by depth. `experiment` is written only for technical material; otherwise it becomes an essay. */
export const ITEM_MIX: Record<Depth, Record<ItemType, number>> = {
  light: { mcq: 1, recall: 1, essay: 1, experiment: 0 },
  standard: { mcq: 2, recall: 2, essay: 1, experiment: 0 },
  deep: { mcq: 2, recall: 3, essay: 2, experiment: 1 },
};

export const DIGEST_THRESHOLD_CHARS = 400_000;
const DIGEST_BATCH = 8;
const DIGEST_OPENING_CHARS = 400;
const OUTLINE_OPENING_CHARS = 600;
const GROUNDING_CAP_CHARS = 40_000;
const GROUNDING_FILL_BELOW_CHARS = 8_000;
const MAX_TOKENS = 32_000;
const DIGEST_MAX_TOKENS = 4_000;
const ITEM_CONCURRENCY = 3;

interface Loaded { source: Source; chunks: SourceChunk[]; summaries?: string[] }

// ---------------------------------------------------------------- errors

/** Translate SDK errors into something the learner can act on. The original is kept as `cause`. */
export function translateError(err: unknown, model: string): Error {
  const wrap = (msg: string) => new Error(msg, { cause: err });
  if (err instanceof Anthropic.APIUserAbortError) return wrap("The build was cancelled.");
  if (err instanceof Anthropic.AuthenticationError) return wrap("The API key was rejected. Check the key in Settings and try again.");
  if (err instanceof Anthropic.PermissionDeniedError) return wrap(`This API key is not allowed to use the model "${model}". Check the key's permissions or choose another model in Settings.`);
  if (err instanceof Anthropic.NotFoundError) return wrap(`The model "${model}" was not found. Check the model name in Settings.`);
  if (err instanceof Anthropic.RateLimitError) return wrap("The API is rate-limiting this key right now. Wait a minute and try again, or build with a smaller depth.");
  if (err instanceof Anthropic.BadRequestError) return wrap(`The API rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return wrap("The API took too long to respond. Try again.");
  if (err instanceof Anthropic.APIConnectionError) return wrap("Could not reach the API. Check the network connection and try again.");
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status >= 500 || status === 529) return wrap(`The API is overloaded or unavailable right now (HTTP ${status}). Try again in a few minutes.`);
    return wrap(`The API returned an error${status ? ` (HTTP ${status})` : ""}: ${err.message}`);
  }
  if (err instanceof Error && err.name === "AbortError") return wrap("The build was cancelled.");
  return err instanceof Error ? err : new Error(String(err));
}

// ---------------------------------------------------------------- one model call

interface CallOpts {
  label: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens: number;
  cacheSystem: boolean;
  signal: AbortSignal | undefined;
}

async function callJson<T>(deps: BuildDeps, usage: Usage, o: CallOpts): Promise<T> {
  let message: Anthropic.Message;
  try {
    const params: Anthropic.MessageStreamParams = {
      model: deps.model,
      max_tokens: o.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: o.effort, format: { type: "json_schema", schema: o.schema } },
      system: [o.cacheSystem
        ? { type: "text", text: o.system, cache_control: { type: "ephemeral" } }
        : { type: "text", text: o.system }],
      messages: [{ role: "user", content: o.user }],
    };
    message = await deps.client.messages.stream(params, { signal: o.signal }).finalMessage();
  } catch (err) {
    throw translateError(err, deps.model);
  }
  addUsage(usage, message.model || deps.model, message.usage);

  if (message.stop_reason === "refusal") {
    throw new Error(`The model declined to ${o.label}. Check the source material and try again.`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(`The model ran out of room writing ${o.label}; try a smaller depth.`);
  }
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { /* fall through */ }
    }
    throw new Error(`The model returned malformed JSON while writing ${o.label}. Try again.`);
  }
}

async function readPrompt(deps: BuildDeps, name: string): Promise<string> {
  const path = join(deps.promptsDir, name);
  try {
    const text = (await readFile(path, "utf8")).trim();
    if (!text) throw new Error("empty");
    return text;
  } catch {
    throw new Error(`The prompt file ${name} is missing or empty (looked in ${deps.promptsDir}).`);
  }
}

// ---------------------------------------------------------------- helpers

const opening = (text: string, n: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + " …" : t;
};

const quote = (s: string) => `"${s.replace(/\s+/g, " ").trim()}"`;

function chunkKey(sourceId: string, chunk: number): string {
  return `${sourceId}#${chunk}`;
}

const STOPWORDS = new Set("the and for with that this from into over under between about which while their there these those than then when where what have has had been being are was were will would could should also only such more most some many much very into onto upon".split(" "));

function keywords(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter((w) => !STOPWORDS.has(w)) ?? []);
}

function scoreChunk(words: Set<string>, text: string): number {
  if (!words.size) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const w of words) if (lower.includes(w)) hits++;
  return hits / words.size;
}

/** Stable Kahn ordering: among ready topics keep the outline order. */
function topoOrder<T extends { id: string; prereq: string[] }>(topics: T[]): T[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const indeg = new Map(topics.map((t) => [t.id, t.prereq.filter((p) => byId.has(p)).length]));
  const out: T[] = [];
  const done = new Set<string>();
  while (out.length < topics.length) {
    // Take the earliest-listed ready topic, then rescan from the start so outline order wins among ties.
    const next = topics.find((t) => !done.has(t.id) && (indeg.get(t.id) ?? 0) === 0);
    if (!next) { // should not happen after cycle breaking; append the rest in order
      for (const t of topics) if (!done.has(t.id)) { out.push(t); done.add(t.id); }
      break;
    }
    out.push(next); done.add(next.id);
    for (const u of topics) if (!done.has(u.id) && u.prereq.includes(next.id)) indeg.set(u.id, (indeg.get(u.id) ?? 1) - 1);
  }
  return out;
}

function reaches(from: string, to: string, edges: Map<string, Set<string>>): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) ?? []) stack.push(next);
  }
  return false;
}

// ---------------------------------------------------------------- the build

export async function buildCourse(req: BuildCourseRequest, deps: BuildDeps): Promise<{ course: Course; usage: Usage }> {
  const startedAt = Date.now();
  const usage = emptyUsage();
  const depth: Depth = req.depth in TOPIC_CAP ? req.depth : "standard";
  let progress = 0;
  const emit = (message: string, p?: number) => { if (p !== undefined) progress = Math.max(progress, Math.min(1, p)); deps.onEvent(message, progress); };
  const checkAborted = () => { if (deps.signal?.aborted) throw new Error("The build was cancelled."); };

  // Inner controller so a failure in one topic cancels the others.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  deps.signal?.addEventListener("abort", onAbort, { once: true });
  if (deps.signal?.aborted) ac.abort();

  try {
    // ------------------------------------------------ 1. load sources
    const ids = Array.from(new Set(req.sourceIds ?? []));
    if (!ids.length) throw new Error("Choose at least one source to build from.");
    emit(`Reading ${ids.length} source${ids.length === 1 ? "" : "s"}`, 0.01);
    const loaded: Loaded[] = [];
    for (let i = 0; i < ids.length; i++) {
      checkAborted();
      const { source, chunks } = await deps.readSource(ids[i]!);
      const usable = chunks.filter((c) => c.text && c.text.trim());
      emit(`Reading ${quote(source.title)} (${i + 1} of ${ids.length})`, 0.01 + 0.07 * ((i + 1) / ids.length));
      if (!usable.length) { emit(`Skipping ${quote(source.title)}: it has no extractable text`); continue; }
      loaded.push({ source, chunks: usable });
    }
    if (!loaded.length) throw new Error("None of the selected sources contain extractable text.");

    const chunkById = new Map<string, { source: Source; chunk: SourceChunk }>();
    for (const l of loaded) for (const c of l.chunks) chunkById.set(chunkKey(l.source.id, c.index), { source: l.source, chunk: c });
    const totalChars = loaded.reduce((n, l) => n + l.chunks.reduce((m, c) => m + c.text.length, 0), 0);
    const totalChunks = chunkById.size;

    // ------------------------------------------------ 1b. digest when large
    if (totalChars > DIGEST_THRESHOLD_CHARS) {
      const batches: { loaded: Loaded; chunks: SourceChunk[] }[] = [];
      for (const l of loaded) {
        l.summaries = new Array<string>(l.chunks.length).fill("");
        for (let i = 0; i < l.chunks.length; i += DIGEST_BATCH) batches.push({ loaded: l, chunks: l.chunks.slice(i, i + DIGEST_BATCH) });
      }
      emit(`Summarising ${totalChunks} chunks (${Math.round(totalChars / 1000)}k characters) in ${batches.length} passes`, 0.09);
      const digestSystem = "You summarise chunks of a document for a course designer who will decide which parts to teach. For each chunk, write one sentence of at most 30 words naming the concepts, claims, procedures or results it contains. State what is there; do not evaluate it. Return JSON matching the schema, one entry per chunk, in order.";
      let doneBatches = 0;
      const digestOne = async (b: { loaded: Loaded; chunks: SourceChunk[] }) => {
        const user = [
          `Source: ${quote(b.loaded.source.title)}. ${b.chunks.length} chunks follow; index them 0 to ${b.chunks.length - 1} in order.`,
          ...b.chunks.map((c, i) => `[${i}] (${c.locator})\n${c.text.slice(0, 3000)}`),
        ].join("\n\n");
        const out = await callJson<DigestOut>(deps, usage, {
          label: `summarise ${quote(b.loaded.source.title)}`, system: digestSystem, user, schema: DIGEST_SCHEMA,
          effort: "low", maxTokens: DIGEST_MAX_TOKENS, cacheSystem: false, signal: ac.signal,
        });
        const base = b.chunks[0]!.index;
        const pos = new Map(b.loaded.chunks.map((c, i) => [c.index, i]));
        for (const s of out.summaries ?? []) {
          const c = b.chunks[s.index];
          if (c && typeof s.summary === "string") b.loaded.summaries![pos.get(c.index) ?? s.index + base] = s.summary.trim();
        }
        doneBatches++;
        emit(`Summarised ${Math.min(doneBatches * DIGEST_BATCH, totalChunks)} of ${totalChunks} chunks`, 0.09 + 0.13 * (doneBatches / batches.length));
      };
      await runPool(batches, ITEM_CONCURRENCY, digestOne, ac);
    }

    // ------------------------------------------------ 2. outline
    checkAborted();
    const cap = TOPIC_CAP[depth];
    emit(`Outlining up to ${cap} topics from ${loaded.length} source${loaded.length === 1 ? "" : "s"}`, 0.23);
    const outlineSystem = await readPrompt(deps, "build-outline.md");
    const digestMode = loaded.some((l) => l.summaries);
    const outlineUser = [
      `Depth: ${depth}. Produce at most ${cap} topics; fewer is right when the material is thin.`,
      req.title ? `The learner has titled the course ${quote(req.title)}; keep that title.` : "Name the course yourself.",
      req.background ? `Learner background (use it to skip what they already know and to order the rest):\n${req.background.trim()}` : "No learner background was given.",
      `Below are the ${loaded.length} source${loaded.length === 1 ? "" : "s"}, ${totalChunks} chunks in total, each with its sourceId, chunk index and locator${digestMode ? ", a one-line summary and the opening of the chunk" : " and the opening of the chunk"}. Cite grounding as { sourceId, chunk } using these values exactly.`,
      ...loaded.map((l) => [
        `## Source ${quote(l.source.title)} — sourceId: ${l.source.id} — ${l.source.kind}${l.source.pages ? `, ${l.source.pages} pages` : ""} — ${l.chunks.length} chunks`,
        ...l.chunks.map((c, i) => digestMode
          ? `[sourceId ${l.source.id} · chunk ${c.index} · ${c.locator}]\nSummary: ${l.summaries?.[i] || "(no summary)"}\nOpening: ${opening(c.text, DIGEST_OPENING_CHARS)}`
          : `[sourceId ${l.source.id} · chunk ${c.index} · ${c.locator}]\n${opening(c.text, OUTLINE_OPENING_CHARS)}`),
      ].join("\n\n")),
    ].join("\n\n");

    const outline = await callJson<OutlineOut>(deps, usage, {
      label: "the course outline", system: outlineSystem, user: outlineUser, schema: OUTLINE_SCHEMA,
      effort: deps.effort, maxTokens: MAX_TOKENS, cacheSystem: true, signal: ac.signal,
    });
    if (!Array.isArray(outline.topics) || !outline.topics.length) throw new Error("The model could not find any teachable topics in these sources.");

    const courseId = deps.newId("course");
    const rawTopics = outline.topics.slice(0, cap);
    if (outline.topics.length > cap) emit(`Keeping the first ${cap} of ${outline.topics.length} proposed topics (depth ${depth})`);

    // Titles → ids; drop unresolved prereqs; break cycles keeping the first edge.
    const topics: Topic[] = rawTopics.map((t) => ({
      id: deps.newId("topic"),
      courseId,
      title: String(t.title ?? "").trim() || "Untitled topic",
      summary: String(t.summary ?? "").trim(),
      prereq: [],
      abstraction: clampInt(t.abstraction, 1, 100, 50),
      grounding: (t.grounding ?? [])
        .filter((g) => chunkById.has(chunkKey(g.sourceId, g.chunk)))
        .map((g) => ({ sourceId: g.sourceId, chunk: g.chunk, locator: chunkById.get(chunkKey(g.sourceId, g.chunk))!.chunk.locator })),
    }));
    const idByTitle = new Map<string, string>();
    topics.forEach((t) => { const k = norm(t.title); if (!idByTitle.has(k)) idByTitle.set(k, t.id); });
    const edges = new Map<string, Set<string>>(); // prereq → dependents
    rawTopics.forEach((raw, i) => {
      const topic = topics[i]!;
      for (const title of raw.prereq ?? []) {
        const pid = idByTitle.get(norm(String(title)));
        if (!pid) { emit(`Dropped an unknown prerequisite ${quote(String(title))} from ${quote(topic.title)}`); continue; }
        if (pid === topic.id || topic.prereq.includes(pid)) continue;
        if (reaches(topic.id, pid, edges)) {
          const other = topics.find((t) => t.id === pid)!;
          emit(`Dropped a prerequisite that would loop: ${quote(other.title)} already depends on ${quote(topic.title)}`);
          continue;
        }
        topic.prereq.push(pid);
        if (!edges.has(pid)) edges.set(pid, new Set());
        edges.get(pid)!.add(topic.id);
      }
    });
    const ordered = topoOrder(topics);
    const uncited = ordered.filter((t) => !t.grounding.length).length;
    emit(`Outlined ${ordered.length} topic${ordered.length === 1 ? "" : "s"}${uncited ? ` (${uncited} without a cited chunk; items will search the sources)` : ""}`, 0.32);

    // ------------------------------------------------ 3. items per topic
    const itemsSystem = await readPrompt(deps, "build-items.md");
    const perTopic = ITEMS_PER_TOPIC[depth];
    const mix = ITEM_MIX[depth];
    const titles = ordered.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
    const results: ItemOut[][] = new Array(ordered.length);
    let doneTopics = 0;

    const writeTopic = async (topic: Topic, i: number) => {
      checkAborted();
      emit(`Writing items for ${quote(topic.title)} (${i + 1} of ${ordered.length})`, 0.32 + 0.63 * (doneTopics / ordered.length));
      const grounding = selectGrounding(topic, chunkById);
      const mixLine = (Object.entries(mix) as [ItemType, number][])
        .filter(([, n]) => n > 0)
        .map(([type, n]) => `${n} ${type}`).join(", ");
      const user = [
        `Course: ${quote(req.title || outline.title)}. Topic ${i + 1} of ${ordered.length}: ${quote(topic.title)}.`,
        `Topic summary: ${topic.summary}`,
        `Abstraction: ${topic.abstraction} (1 broad … 100 specific).`,
        `All topics in the course, in order (write items for the current topic only; do not duplicate what another topic will cover):\n${titles}`,
        `Write exactly ${perTopic} items: ${mixLine}.${mix.experiment ? " Write the experiment item only if the material is technical (code, data, procedures, calculations the learner can carry out); otherwise write an essay in its place." : ""}`,
        req.background ? `Learner background (for bridges and for pitching difficulty):\n${req.background.trim()}` : "No learner background was given; leave bridge null on every item.",
        `Prerequisites between items: reference by 1-based position within your list. Every item must cite at least one grounding chunk using the sourceId and chunk values exactly as labelled below.`,
        `Grounding text (${grounding.length} chunk${grounding.length === 1 ? "" : "s"}):`,
        ...grounding.map((g) => `[sourceId ${g.source.id} · chunk ${g.chunk.index} · ${g.chunk.locator}]\n${g.text}`),
      ].join("\n\n");
      const out = await callJson<ItemsOut>(deps, usage, {
        label: `items for ${quote(topic.title)}`, system: itemsSystem, user, schema: ITEMS_SCHEMA,
        effort: deps.effort, maxTokens: MAX_TOKENS, cacheSystem: true, signal: ac.signal,
      });
      results[i] = Array.isArray(out.items) ? out.items.slice(0, perTopic) : [];
      doneTopics++;
      emit(`Wrote ${results[i]!.length} items for ${quote(topic.title)} (${doneTopics} of ${ordered.length} topics done)`, 0.32 + 0.63 * (doneTopics / ordered.length));
    };

    // First topic alone, so the cached system prompt is written once before the fan-out reads it.
    await writeTopic(ordered[0]!, 0);
    if (ordered.length > 1) {
      await runPool(ordered.slice(1).map((t, j) => ({ t, i: j + 1 })), ITEM_CONCURRENCY, ({ t, i }) => writeTopic(t, i), ac);
    }

    // ------------------------------------------------ 4. validate
    checkAborted();
    const proposed = results.reduce((n, r) => n + (r?.length ?? 0), 0);
    emit(`Checking ${proposed} items`, 0.96);
    const items = validateItems(ordered, results, courseId, chunkById, (msg) => emit(msg));
    const emptyTopics = ordered.filter((t) => !items.some((it) => it.topicId === t.id));
    for (const t of emptyTopics) emit(`${quote(t.title)} has no usable items yet; it stays in the course so you can rebuild it`);

    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    const course: Course = {
      id: courseId,
      title: (req.title || outline.title || "Untitled course").trim(),
      description: String(outline.description ?? "").trim(),
      sourceIds: ids,
      topics: ordered,
      items,
      created: new Date().toISOString(),
      build: { model: deps.model, usage, seconds },
    };
    emit(`Built ${quote(course.title)}: ${ordered.length} topics, ${items.length} items, ${usage.calls} model calls, about $${usage.estimatedCost.toFixed(2)}`, 1);
    return { course, usage };
  } catch (err) {
    ac.abort();
    throw err;
  } finally {
    deps.signal?.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------- pieces

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** Run `fn` over `items` with at most `limit` in flight; the first failure aborts the rest. */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, ac: AbortController): Promise<void> {
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (next < items.length && !ac.signal.aborted && failure === undefined) {
      const item = items[next++]!;
      try { await fn(item); } catch (err) { if (failure === undefined) failure = err; ac.abort(); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== undefined) throw failure;
}

interface GroundingPick { source: Source; chunk: SourceChunk; text: string }

/** The chunks the outline named, in order, then (only if that is thin) the best keyword matches, capped at ~40k chars. */
function selectGrounding(topic: Topic, chunkById: Map<string, { source: Source; chunk: SourceChunk }>): GroundingPick[] {
  const picks: GroundingPick[] = [];
  const used = new Set<string>();
  let total = 0;
  const add = (entry: { source: Source; chunk: SourceChunk }) => {
    const key = chunkKey(entry.source.id, entry.chunk.index);
    if (used.has(key) || total >= GROUNDING_CAP_CHARS) return;
    const room = GROUNDING_CAP_CHARS - total;
    const text = entry.chunk.text.length > room ? entry.chunk.text.slice(0, room) + " …" : entry.chunk.text;
    if (text.length < 200 && picks.length) return; // not worth a truncated stub
    used.add(key);
    total += text.length;
    picks.push({ source: entry.source, chunk: entry.chunk, text });
  };
  for (const g of topic.grounding) {
    const e = chunkById.get(chunkKey(g.sourceId, g.chunk));
    if (e) add(e);
  }
  if (total < GROUNDING_FILL_BELOW_CHARS) {
    const words = keywords(`${topic.title} ${topic.summary}`);
    const scored = Array.from(chunkById.values())
      .filter((e) => !used.has(chunkKey(e.source.id, e.chunk.index)))
      .map((e) => ({ e, s: scoreChunk(words, e.chunk.text) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    for (const { e } of scored) {
      if (total >= GROUNDING_FILL_BELOW_CHARS * 2) break;
      add(e);
    }
    if (!picks.length) { // nothing matched at all: give the model the start of the first source
      const first = chunkById.values().next().value;
      if (first) add(first);
    }
  }
  return picks;
}

function validateItems(
  topics: Topic[],
  results: ItemOut[][],
  courseId: string,
  chunkById: Map<string, { source: Source; chunk: SourceChunk }>,
  warn: (msg: string) => void,
): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  let n = 0;

  topics.forEach((topic, ti) => {
    const raw = results[ti] ?? [];
    // Assign ids first so within-topic positional prereqs can resolve to ids of items that survive.
    // Ids are namespaced by course: scheduling state and the graph key items by id across courses.
    const assigned = raw.map((r) => ({ r, id: `${topic.courseId}_item_${++n}` }));
    const kept = new Set<string>();
    const draft: Item[] = [];

    for (const { r, id } of assigned) {
      const where = `${quote(topic.title)}: ${quote(opening(String(r?.prompt ?? ""), 60))}`;
      if (!r || typeof r.prompt !== "string" || !r.prompt.trim()) { warn(`Dropped an item with no prompt in ${quote(topic.title)}`); continue; }
      const type = r.type;
      if (!["mcq", "recall", "essay", "experiment"].includes(type)) { warn(`Dropped an item with unknown type in ${where}`); continue; }
      if (typeof r.answerKey !== "string" || !r.answerKey.trim()) { warn(`Dropped an item with no answer key in ${where}`); continue; }
      if (seen.has(id)) { warn(`Dropped a duplicate item id ${id}`); continue; }

      const item: Item = {
        id, courseId, topicId: topic.id, type,
        difficulty: clampInt(r.difficulty, 1, 3, 2) as 1 | 2 | 3,
        prompt: r.prompt.trim(),
        answerKey: r.answerKey.trim(),
        prereq: [],
        grounding: [],
      };
      if (type === "mcq") {
        const choices = Array.isArray(r.choices) ? r.choices.map((c) => String(c ?? "").trim()).filter(Boolean) : [];
        if (choices.length !== 4) { warn(`Dropped an mcq with ${choices.length} choices (needs 4) in ${where}`); continue; }
        if (typeof r.answerIndex !== "number" || !Number.isInteger(r.answerIndex) || r.answerIndex < 0 || r.answerIndex > 3) { warn(`Dropped an mcq whose answer index is out of range in ${where}`); continue; }
        item.choices = choices;
        item.answerIndex = r.answerIndex;
      }
      if (type === "essay" || type === "experiment") {
        const rubric = Array.isArray(r.rubric) ? r.rubric.map((c) => String(c ?? "").trim()).filter(Boolean) : [];
        if (!rubric.length) { warn(`Dropped a ${type} item with no rubric in ${where}`); continue; }
        item.rubric = rubric.slice(0, 6);
      }
      for (const g of r.grounding ?? []) {
        const e = chunkById.get(chunkKey(String(g?.sourceId), Number(g?.chunk)));
        if (e && !item.grounding.some((x) => x.sourceId === e.source.id && x.chunk === e.chunk.index)) {
          item.grounding.push({ sourceId: e.source.id, chunk: e.chunk.index, locator: e.chunk.locator });
        }
      }
      if (!item.grounding.length) {
        if (topic.grounding.length) item.grounding.push(topic.grounding[0]!);
        else { warn(`Dropped an item that cites no known chunk in ${where}`); continue; }
      }
      if (typeof r.bridge === "string" && r.bridge.trim()) item.bridge = r.bridge.trim();
      (item as Item & { _prereq?: number[] })._prereq = Array.isArray(r.prereq) ? r.prereq : [];
      seen.add(id);
      kept.add(id);
      draft.push(item);
    }

    for (const item of draft) {
      const positions = (item as Item & { _prereq?: number[] })._prereq ?? [];
      delete (item as Item & { _prereq?: number[] })._prereq;
      for (const p of positions) {
        const target = assigned[Number(p) - 1];
        if (!target || !kept.has(target.id)) { warn(`Dropped a prerequisite pointing at a missing item in ${quote(topic.title)}`); continue; }
        if (target.id === item.id || item.prereq.includes(target.id)) continue;
        item.prereq.push(target.id);
      }
    }
    items.push(...draft);
  });
  return items;
}
