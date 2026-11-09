import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import type { Source, SourceChunk } from "@mastery/shared";
import { buildCourse, type BuildDeps } from "./buildCourse.js";
import { rateFor, emptyUsage, addUsage } from "./usage.js";

const PROMPTS_DIR = fileURLToPath(new URL("../../../../prompts/", import.meta.url));

// ---------------------------------------------------------------- fake client

interface Call {
  kind: "digest" | "outline" | "items";
  params: Record<string, unknown>;
  start: number;
  end: number;
  inFlightAtStart: number;
}

interface FakeOpts {
  outline: (params: Record<string, unknown>) => unknown;
  items: (params: Record<string, unknown>, callIndex: number) => unknown;
  digest?: (params: Record<string, unknown>) => unknown;
  usage?: (call: Call) => Partial<Anthropic.Usage>;
  model?: string;
  stopReason?: string;
  delayMs?: number;
}

function fakeClient(opts: FakeOpts) {
  const calls: Call[] = [];
  let seq = 0;
  let inFlight = 0;
  const client = {
    messages: {
      stream(params: Record<string, unknown>, _options?: unknown) {
        const format = (params.output_config as { format: { schema: { properties: Record<string, unknown> } } }).format;
        const props = format.schema.properties;
        const kind: Call["kind"] = "topics" in props ? "outline" : "items" in props ? "items" : "digest";
        const call: Call = { kind, params, start: seq++, end: -1, inFlightAtStart: inFlight };
        inFlight++;
        calls.push(call);
        return {
          async finalMessage() {
            await new Promise((r) => setTimeout(r, opts.delayMs ?? 5));
            const itemCalls = calls.filter((c) => c.kind === "items").indexOf(call);
            const body = kind === "outline" ? opts.outline(params) : kind === "items" ? opts.items(params, itemCalls) : (opts.digest ?? defaultDigest)(params);
            call.end = seq++;
            inFlight--;
            const u = opts.usage?.(call) ?? {};
            return {
              id: "msg_fake", type: "message", role: "assistant",
              model: opts.model ?? "claude-opus-5-5",
              content: [{ type: "text", text: JSON.stringify(body) }],
              stop_reason: opts.stopReason ?? "end_turn",
              stop_sequence: null,
              usage: {
                input_tokens: u.input_tokens ?? 1000,
                output_tokens: u.output_tokens ?? 200,
                cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
                cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
              },
            };
          },
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

function defaultDigest(params: Record<string, unknown>) {
  const user = (params.messages as { content: string }[])[0]!.content;
  const n = (user.match(/^\[\d+\] \(/gm) ?? []).length;
  return { summaries: Array.from({ length: n }, (_, i) => ({ index: i, summary: `Summary of chunk ${i}` })) };
}

// ---------------------------------------------------------------- fake sources

function makeSource(id: string, title: string, chunkTexts: string[]): { source: Source; chunks: SourceChunk[] } {
  const chunks = chunkTexts.map((text, index) => ({ index, locator: `pp. ${index * 3 + 1}–${index * 3 + 3}`, text }));
  return {
    source: { id, title, kind: "pdf", origin: `${title}.pdf`, bytes: 1, chars: chunkTexts.join("").length, pages: 9, added: "2026-01-01", chunks: chunks.length, hash: `hash-${id}`, method: "text" },
    chunks,
  };
}

const sources = new Map([
  ["src_a", makeSource("src_a", "Sampling Notes", ["Sampling distributions arise when...", "The bootstrap resamples with replacement...", "Stratified sampling partitions the frame..."])],
  ["src_b", makeSource("src_b", "Estimation Primer", ["Bias and variance of an estimator...", "Confidence intervals cover the parameter..."])],
]);

function makeDeps(client: Anthropic, extra: Partial<BuildDeps> = {}) {
  const events: { message: string; progress: number }[] = [];
  let counter = 0;
  const deps: BuildDeps = {
    client,
    model: "claude-opus-5-5",
    effort: "high",
    promptsDir: PROMPTS_DIR,
    async readSource(id) {
      const s = sources.get(id);
      if (!s) throw new Error(`no source ${id}`);
      return s;
    },
    onEvent(message, progress) { events.push({ message, progress }); },
    newId(prefix) { return `${prefix}_${++counter}`; },
    ...extra,
  };
  return { deps, events };
}

// Outline in a deliberately wrong order with a cycle and an unknown prerequisite.
const OUTLINE = {
  title: "Sampling and Estimation",
  description: "You will learn how samples relate to populations.",
  topics: [
    { title: "The bootstrap", summary: "Resampling approximates the sampling distribution.", prereq: ["Sampling distributions"], abstraction: 60, grounding: [{ sourceId: "src_a", chunk: 1 }] },
    { title: "Sampling distributions", summary: "The distribution of a statistic over repeated samples.", prereq: ["The bootstrap"], abstraction: 20, grounding: [{ sourceId: "src_a", chunk: 0 }, { sourceId: "src_zzz", chunk: 9 }] },
    { title: "Confidence intervals", summary: "Intervals that cover the parameter at a stated rate.", prereq: ["Nonexistent topic", "Sampling distributions"], abstraction: 140, grounding: [{ sourceId: "src_b", chunk: 1 }] },
  ],
};

function itemsFor(topicTitle: string) {
  const g = [{ sourceId: "src_a", chunk: 0 }];
  return {
    items: [
      { type: "recall", difficulty: 1, prompt: `Explain ${topicTitle}.`, choices: null, answerIndex: null, answerKey: "Must state the mechanism.", rubric: null, prereq: [], grounding: g, bridge: null },
      { type: "mcq", difficulty: 2, prompt: `Which holds for ${topicTitle}?`, choices: ["a", "b", "c", "d"], answerIndex: 2, answerKey: "c because...", rubric: null, prereq: [1], grounding: [{ sourceId: "src_b", chunk: 1 }], bridge: "You already know this from your work." },
      { type: "mcq", difficulty: 2, prompt: "Broken mcq", choices: ["a", "b", "c", "d"], answerIndex: 7, answerKey: "x", rubric: null, prereq: [], grounding: g, bridge: null },
      { type: "essay", difficulty: 3, prompt: "Broken essay with no rubric", choices: null, answerIndex: null, answerKey: "x", rubric: null, prereq: [], grounding: g, bridge: null },
      { type: "essay", difficulty: 9, prompt: `Argue about ${topicTitle}.`, choices: null, answerIndex: null, answerKey: "Position: ...", rubric: ["States X", "Names the condition Y", "Commits to a side"], prereq: [1, 2, 99, 3], grounding: [{ sourceId: "nope", chunk: 0 }], bridge: null },
    ],
  };
}

// ---------------------------------------------------------------- tests

test("buildCourse: orders topics, resolves ids, breaks cycles, validates items, totals usage, and runs the first topic alone", async () => {
  const { client, calls } = fakeClient({
    outline: () => OUTLINE,
    items: (params) => {
      const user = (params.messages as { content: string }[])[0]!.content;
      const m = /Topic \d+ of \d+: "([^"]+)"/.exec(user);
      return itemsFor(m?.[1] ?? "?");
    },
    usage: (call) => call.kind === "items"
      ? (call.inFlightAtStart === 0 && calls.filter((c) => c.kind === "items").indexOf(call) === 0
        ? { input_tokens: 500, cache_creation_input_tokens: 2000 }
        : { input_tokens: 500, cache_read_input_tokens: 2000 })
      : { input_tokens: 3000, cache_creation_input_tokens: 1500 },
  });
  const { deps, events } = makeDeps(client);
  const { course, usage } = await buildCourse({ sourceIds: ["src_a", "src_b"], depth: "standard", background: "I work with survey data." }, deps);

  // Topics: dependency order, ids resolved, unknown prereq dropped, back edge dropped.
  assert.deepEqual(course.topics.map((t) => t.title), ["Sampling distributions", "The bootstrap", "Confidence intervals"]);
  const byTitle = Object.fromEntries(course.topics.map((t) => [t.title, t]));
  assert.deepEqual(byTitle["Sampling distributions"]!.prereq, [], "the back edge was dropped");
  assert.deepEqual(byTitle["The bootstrap"]!.prereq, [byTitle["Sampling distributions"]!.id]);
  assert.deepEqual(byTitle["Confidence intervals"]!.prereq, [byTitle["Sampling distributions"]!.id]);
  assert.equal(byTitle["Confidence intervals"]!.abstraction, 100, "abstraction clamped");
  assert.deepEqual(byTitle["Sampling distributions"]!.grounding, [{ sourceId: "src_a", chunk: 0, locator: "pp. 1–3" }], "unknown chunk dropped, locator attached");
  assert.ok(events.some((e) => /would loop/.test(e.message)), "cycle warning emitted");
  assert.ok(events.some((e) => /unknown prerequisite "Nonexistent topic"/.test(e.message)), "unknown prereq warning emitted");
  for (const t of course.topics) assert.equal(t.courseId, course.id);

  // Items: 5 proposed per topic, 2 invalid dropped → 3 per topic; ids deterministic and unique.
  assert.equal(course.items.length, 9);
  assert.equal(new Set(course.items.map((i) => i.id)).size, 9);
  assert.ok(course.items.every((i) => new RegExp(`^${course.id}_item_\\d+$`).test(i.id)));
  assert.deepEqual(course.items.slice(0, 3).map((i) => i.type), ["recall", "mcq", "essay"]);
  // Items follow the (reordered) topic order.
  assert.equal(course.items[0]!.topicId, byTitle["Sampling distributions"]!.id);
  assert.equal(course.items[8]!.topicId, byTitle["Confidence intervals"]!.id);
  assert.ok(events.some((e) => /answer index is out of range/.test(e.message)));
  assert.ok(events.some((e) => /no rubric/.test(e.message)));
  // Positional prereqs resolve to ids within the topic; missing positions are dropped, duplicates ignored.
  const [recall, mcq, essay] = course.items as [typeof course.items[0], typeof course.items[0], typeof course.items[0]];
  assert.deepEqual(mcq.prereq, [recall.id]);
  assert.deepEqual(essay.prereq, [recall.id, mcq.id], "position 3 (dropped item) and 99 do not resolve");
  assert.ok(events.some((e) => /prerequisite pointing at a missing item/.test(e.message)));
  // Difficulty clamped; unknown grounding falls back to the topic's grounding; bridge kept; locator attached.
  assert.equal(essay.difficulty, 3);
  assert.deepEqual(essay.grounding, byTitle["Sampling distributions"]!.grounding);
  assert.equal(mcq.bridge, "You already know this from your work.");
  assert.deepEqual(mcq.grounding, [{ sourceId: "src_b", chunk: 1, locator: "pp. 4–6" }]);
  assert.equal(mcq.answerIndex, 2);
  assert.equal(mcq.choices?.length, 4);

  // Call order: outline, then the first items call completes before any other items call starts.
  assert.deepEqual(calls.map((c) => c.kind), ["outline", "items", "items", "items"]);
  const itemCalls = calls.filter((c) => c.kind === "items");
  assert.ok(itemCalls[0]!.end < itemCalls[1]!.start, "first topic ran alone");
  assert.ok(itemCalls[0]!.end < itemCalls[2]!.start, "first topic ran alone");
  assert.ok(itemCalls.slice(1).every((c) => c.inFlightAtStart <= 3));

  // Request shape: adaptive thinking, no budget/temperature, cached system block, json_schema format.
  for (const c of calls) {
    const p = c.params as Record<string, unknown>;
    assert.equal(p.model, "claude-opus-5-5");
    assert.deepEqual(p.thinking, { type: "adaptive" });
    assert.equal("temperature" in p, false);
    assert.equal(p.max_tokens, 32000);
    const oc = p.output_config as { effort: string; format: { type: string } };
    assert.equal(oc.effort, "high");
    assert.equal(oc.format.type, "json_schema");
    const sys = p.system as { type: string; text: string; cache_control?: unknown }[];
    assert.deepEqual(sys[0]!.cache_control, { type: "ephemeral" });
    assert.ok(sys[0]!.text.length > 500, "system prompt read from the prompts dir");
  }
  const outlineUser = (calls[0]!.params.messages as { content: string }[])[0]!.content;
  assert.match(outlineUser, /Depth: standard\. Produce at most 10 topics/);
  assert.match(outlineUser, /I work with survey data/);
  assert.match(outlineUser, /\[sourceId src_a · chunk 1 · pp\. 4–6\]/);
  const itemUser = (itemCalls[0]!.params.messages as { content: string }[])[0]!.content;
  assert.match(itemUser, /Write exactly 5 items: 2 mcq, 2 recall, 1 essay\./);
  assert.match(itemUser, /\[sourceId src_a · chunk 0 · pp\. 1–3\]\nSampling distributions arise when/, "named grounding chunk text is included with its label");
  const bootstrapUser = (itemCalls.find((c) => /Topic 2 of 3: "The bootstrap"/.test((c.params.messages as { content: string }[])[0]!.content))!.params.messages as { content: string }[])[0]!.content;
  assert.match(bootstrapUser, /The bootstrap resamples with replacement/, "each topic gets its own named chunks");

  // Usage: 1 outline (3000 in, 1500 write) + 3 items (500 in; 2000 write once, 2000 read twice), 200 out each.
  assert.equal(usage.calls, 4);
  assert.equal(usage.input, 3000 + 3 * 500);
  assert.equal(usage.output, 4 * 200);
  assert.equal(usage.cacheWrite, 1500 + 2000);
  assert.equal(usage.cacheRead, 4000);
  assert.ok(Math.abs(usage.cacheHitRatio - 4000 / (4500 + 3500 + 4000)) < 1e-9);
  const expectedCost = (4500 * 4 + 3500 * 4 * 1.25 + 4000 * 4 * 0.1 + 800 * 20) / 1e6;
  assert.ok(Math.abs(usage.estimatedCost - expectedCost) < 1e-6, `${usage.estimatedCost} vs ${expectedCost}`);
  assert.deepEqual(Object.keys(usage.perModel), ["claude-opus-5-5"]);
  assert.equal(usage.perModel["claude-opus-5-5"]!.calls, 4);
  assert.deepEqual(course.build.usage, usage);
  assert.equal(course.build.model, "claude-opus-5-5");
  assert.deepEqual(course.sourceIds, ["src_a", "src_b"]);
  assert.equal(course.title, "Sampling and Estimation");

  // Events: present tense, monotone progress ending at 1.
  assert.ok(events.some((e) => /^Outlining up to 10 topics from 2 sources$/.test(e.message)));
  assert.ok(events.some((e) => /^Writing items for "Sampling distributions" \(1 of 3\)$/.test(e.message)));
  assert.equal(events[events.length - 1]!.progress, 1);
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.progress >= events[i - 1]!.progress, "progress never goes backwards");
});

test("buildCourse: depth caps topics and items; a topic with zero valid items is kept", async () => {
  const many = { ...OUTLINE, topics: Array.from({ length: 9 }, (_, i) => ({ title: `Topic ${i + 1}`, summary: "s", prereq: [], abstraction: 50, grounding: [{ sourceId: "src_a", chunk: i % 3 }] })) };
  const { client, calls } = fakeClient({
    outline: () => many,
    items: (_p, idx) => idx === 2 ? { items: [{ type: "essay", difficulty: 1, prompt: "no rubric", choices: null, answerIndex: null, answerKey: "k", rubric: null, prereq: [], grounding: [], bridge: null }] }
      : { items: Array.from({ length: 7 }, (_, i) => ({ type: "recall", difficulty: 1, prompt: `q${i}`, choices: null, answerIndex: null, answerKey: "k", rubric: null, prereq: [], grounding: [{ sourceId: "src_a", chunk: 0 }], bridge: null })) },
  });
  const { deps, events } = makeDeps(client);
  const { course } = await buildCourse({ sourceIds: ["src_a"], depth: "light", title: "My title" }, deps);
  assert.equal(course.topics.length, 6, "light caps at 6 topics");
  assert.equal(course.title, "My title");
  assert.equal(calls.filter((c) => c.kind === "items").length, 6);
  const perTopic = course.topics.map((t) => course.items.filter((i) => i.topicId === t.id).length);
  assert.deepEqual(perTopic, [3, 3, 0, 3, 3, 3], "light keeps 3 items per topic; the empty topic stays");
  assert.ok(events.some((e) => /has no usable items yet/.test(e.message)));
  assert.ok(events.some((e) => /Keeping the first 6 of 9/.test(e.message)));
  const itemUser = (calls.find((c) => c.kind === "items")!.params.messages as { content: string }[])[0]!.content;
  assert.match(itemUser, /Write exactly 3 items: 1 mcq, 1 recall, 1 essay\./);
});

test("buildCourse: large inputs are digested first in batches of 8 at low effort", async () => {
  const big = makeSource("src_big", "Big Book", Array.from({ length: 20 }, (_, i) => `Chunk ${i} ` + "word ".repeat(5000)));
  sources.set("src_big", big);
  try {
    const { client, calls } = fakeClient({
      outline: () => ({ ...OUTLINE, topics: [{ title: "Only topic", summary: "s", prereq: [], abstraction: 50, grounding: [{ sourceId: "src_big", chunk: 3 }] }] }),
      items: () => itemsFor("Only topic"),
    });
    const { deps, events } = makeDeps(client);
    const { course } = await buildCourse({ sourceIds: ["src_big"], depth: "deep" }, deps);
    const digests = calls.filter((c) => c.kind === "digest");
    assert.equal(digests.length, 3, "20 chunks → 3 batches of up to 8");
    for (const d of digests) {
      const oc = d.params.output_config as { effort: string };
      assert.equal(oc.effort, "low");
      const sys = d.params.system as { cache_control?: unknown }[];
      assert.equal(sys[0]!.cache_control, undefined);
    }
    assert.ok(events.some((e) => /^Summarising 20 chunks/.test(e.message)));
    const outlineUser = (calls.find((c) => c.kind === "outline")!.params.messages as { content: string }[])[0]!.content;
    assert.match(outlineUser, /Summary: Summary of chunk 3/);
    assert.ok(calls.indexOf(calls.find((c) => c.kind === "outline")!) > digests[2]!.start, "digest before outline");
    assert.equal(course.topics.length, 1);
    const itemUser = (calls.find((c) => c.kind === "items")!.params.messages as { content: string }[])[0]!.content;
    assert.match(itemUser, /Write exactly 8 items: 2 mcq, 3 recall, 2 essay, 1 experiment\./);
    assert.ok(itemUser.length < 60_000, "grounding text capped");
  } finally {
    sources.delete("src_big");
  }
});

test("buildCourse: refusal and max_tokens become clear errors; empty inputs fail early", async () => {
  const refused = fakeClient({ outline: () => OUTLINE, items: () => ({ items: [] }), stopReason: "refusal" });
  await assert.rejects(buildCourse({ sourceIds: ["src_a"], depth: "light" }, makeDeps(refused.client).deps), /declined/);

  const cut = fakeClient({ outline: () => OUTLINE, items: () => ({ items: [] }), stopReason: "max_tokens" });
  await assert.rejects(buildCourse({ sourceIds: ["src_a"], depth: "light" }, makeDeps(cut.client).deps), /ran out of room writing the course outline; try a smaller depth/);

  const ok = fakeClient({ outline: () => OUTLINE, items: () => ({ items: [] }) });
  await assert.rejects(buildCourse({ sourceIds: [], depth: "light" }, makeDeps(ok.client).deps), /at least one source/);
  assert.equal(ok.calls.length, 0);

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(buildCourse({ sourceIds: ["src_a"], depth: "light" }, makeDeps(ok.client, { signal: aborted.signal }).deps), /cancelled/);

  const missingPrompts = fakeClient({ outline: () => OUTLINE, items: () => ({ items: [] }) });
  await assert.rejects(buildCourse({ sourceIds: ["src_a"], depth: "light" }, makeDeps(missingPrompts.client, { promptsDir: "/nonexistent/prompts" }).deps), /build-outline\.md is missing/);
});

test("usage: rates resolve by exact id, then longest prefix, then the unknown rate", () => {
  assert.deepEqual(rateFor("claude-opus-5-5"), { input: 4, output: 20 });
  assert.deepEqual(rateFor("claude-opus-5"), { input: 5, output: 25 });
  assert.deepEqual(rateFor("claude-opus-5-5-20260401"), { input: 4, output: 20 });
  assert.deepEqual(rateFor("claude-haiku-5-5"), { input: 0.1, output: 0.5 });
  assert.deepEqual(rateFor("some-future-model"), { input: 5, output: 25 });
  const u = addUsage(emptyUsage(), "claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: null, cache_read_input_tokens: 1_000_000 } as Anthropic.Usage);
  assert.ok(Math.abs(u.estimatedCost - (2 + 1 + 0.2)) < 1e-9);
  assert.equal(u.cacheHitRatio, 0.5);
});
