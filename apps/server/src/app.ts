import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { AppState, BuildCourseRequest, CourseSummary, Settings, Source, SubmitRequest } from "@mastery/shared";
import { PROMPTS_DIR } from "./config.js";
import { buildGraph } from "./graph.js";
import { newId, nowIso } from "./ids.js";
import { UrlError, chunkText, extractFile, extractUrl } from "./ingest/index.js";
import * as jobs from "./jobs.js";
import { KeyError, keyStatus, setKey, validateKey } from "./keys.js";
import { LlmError, readPrompt } from "./llm.js";
import { statsFor } from "./scheduler.js";
import { SessionError, missedConceptsByItem, newSession, publicItem, submitSession } from "./sessions.js";
import * as store from "./store.js";
import * as library from "./library.js";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const app = new Hono();
library.ensureLibrary();
app.use("/api/*", cors({ origin: (o) => (o?.startsWith("http://localhost") || o?.startsWith("http://127.0.0.1") ? o : null) }));

app.onError((err, c) => {
  if (err instanceof KeyError || err instanceof SessionError) return c.json({ error: err.message }, 400);
  if (err instanceof UrlError) return c.json({ error: err.message }, err.status);
  if (err instanceof LlmError) return c.json({ error: err.message }, 502);
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
});

function courseSummaries(): CourseSummary[] {
  const state = store.loadState();
  const threshold = store.loadSettings().graphThreshold;
  return store.listCourses().map(({ topics, items, ...rest }) => ({
    ...rest,
    topicCount: topics.length,
    itemCount: items.length,
    stats: statsFor(items, state, threshold),
  }));
}

app.get("/api/state", (c) => {
  const courses = courseSummaries();
  const graph = buildGraph(store.listCourses(), store.loadState(), store.loadSettings().graphThreshold, missedConceptsByItem());
  const body: AppState = {
    courses,
    sources: library.listSources(),
    settings: store.loadSettings(),
    key: keyStatus(),
    sessionsDone: store.listSessions().length,
    due: courses.reduce((n, x) => n + x.stats.due, 0),
    fresh: courses.reduce((n, x) => n + (x.stats.total - x.stats.seen), 0),
    calibration: store.calibrationHistory(),
    graph: { nodes: graph.nodes.length, links: graph.links.length, pending: graph.pending },
  };
  return c.json(body);
});

// ---- settings and keys
app.get("/api/settings", (c) => c.json(store.loadSettings()));
app.put("/api/settings", async (c) => c.json(store.saveSettings((await c.req.json()) as Partial<Settings>)));
app.get("/api/keys", (c) => c.json(keyStatus()));
app.put("/api/keys", async (c) => c.json(await setKey(await c.req.json())));
app.post("/api/keys/validate", async (c) => c.json(await validateKey()));

// ---- library
app.get("/api/library", (c) => c.json(library.listSources()));
app.post("/api/library", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("files").filter((f) => typeof f !== "string") as unknown as (Blob & { name: string })[];
  if (!files.length) return c.json({ error: "No files received." }, 400);
  const added: Source[] = [];
  for (const file of files) {
    if (file.size > 60 * 1024 * 1024) return c.json({ error: `${file.name} is over 60 MB.` }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = library.sha256(bytes);
    const dup = library.findByHash(hash);
    if (dup) { added.push({ ...dup, warning: `Already in the library as "${dup.title}"` }); continue; }
    const ex = await extractFile(file.name, file.type || undefined, bytes);
    added.push(library.addSource({
      id: newId("src"), title: ex.title || file.name, kind: ex.kind, origin: file.name, bytes: file.size, pages: ex.pages,
      hash, method: ex.method, needsOcr: ex.needsOcr?.length ? ex.needsOcr : undefined, warning: ex.warning,
    }, ex.text, bytes));
  }
  return c.json(added);
});
app.post("/api/library/url", async (c) => {
  const { url } = (await c.req.json()) as { url?: string };
  if (!url) return c.json({ error: "No URL given." }, 400);
  const ex = await extractUrl(url);
  const bytes = new TextEncoder().encode(ex.text);
  const hash = library.sha256(bytes);
  const dup = library.findByHash(hash);
  if (dup) return c.json({ ...dup, warning: `Already in the library as "${dup.title}"` });
  return c.json(library.addSource({ id: newId("src"), title: ex.title || url, kind: "url", origin: url, bytes: bytes.byteLength, hash, method: ex.method, warning: ex.warning }, ex.text));
});
app.get("/api/library/:id/text", (c) => {
  const id = c.req.param("id");
  if (!library.getSource(id)) return c.json({ error: "Unknown source." }, 404);
  const chunks = library.getChunks(id);
  const n = c.req.query("chunk");
  if (n !== undefined) {
    const chunk = chunks[Number(n)];
    return chunk ? c.json(chunk) : c.json({ error: "No such chunk." }, 404);
  }
  return c.json({ chunks });
});
app.get("/api/library/:id/markdown", (c) => {
  const md = library.getMarkdown(c.req.param("id"));
  return md === null ? c.json({ error: "Unknown source." }, 404) : c.json({ markdown: md });
});
app.put("/api/library/:id/markdown", async (c) => {
  const { markdown } = (await c.req.json()) as { markdown?: string };
  if (typeof markdown !== "string") return c.json({ error: "No markdown given." }, 400);
  if (markdown.length > 20_000_000) return c.json({ error: "That is too large to store." }, 400);
  const source = library.updateMarkdown(c.req.param("id"), markdown);
  return source ? c.json(source) : c.json({ error: "Unknown source." }, 404);
});
app.post("/api/library/:id/ocr", (c) => {
  const id = c.req.param("id");
  const source = library.getSource(id);
  if (!source) return c.json({ error: "Unknown source." }, 404);
  if (source.kind !== "pdf") return c.json({ error: "Only PDFs can be transcribed." }, 400);
  if (!source.needsOcr?.length) return c.json({ error: "Every page of this PDF already has text." }, 400);
  if (keyStatus().mode === "none" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return c.json({ error: "Add an API key in Settings before transcribing." }, 400);
  return c.json(jobs.startOcr(id, c.req.header("x-mastery-lang") ?? c.req.header("accept-language")));
});
app.delete("/api/library/:id", (c) => (library.deleteSource(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Unknown source." }, 404)));

// ---- courses and builds
app.get("/api/courses", (c) => c.json(courseSummaries()));
app.get("/api/courses/:id", (c) => {
  const course = store.getCourse(c.req.param("id"));
  if (!course) return c.json({ error: "Unknown course." }, 404);
  const state = store.loadState();
  return c.json({ ...course, items: course.items.map((i) => ({ ...publicItem(i, course), state: state.items[i.id] ?? null })) });
});
app.delete("/api/courses/:id", (c) => (store.deleteCourse(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Unknown course." }, 404)));
app.post("/api/courses/build", async (c) => {
  const req = (await c.req.json()) as BuildCourseRequest;
  if (!req.sourceIds?.length) return c.json({ error: "Choose at least one source." }, 400);
  for (const id of req.sourceIds) if (!library.getSource(id)) return c.json({ error: `Unknown source ${id}.` }, 400);
  if (!keyStatus().mode || keyStatus().mode === "none") {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return c.json({ error: "Add an API key in Settings before building a course." }, 400);
  }
  req.background ||= store.loadSettings().background || undefined;
  return c.json(jobs.startBuild(req, c.req.header("x-mastery-lang") ?? c.req.header("accept-language")));
});
app.get("/api/jobs/:id", (c) => {
  const job = jobs.getJob(c.req.param("id"));
  return job ? c.json(job) : c.json({ error: "Unknown job." }, 404);
});
app.get("/api/jobs/:id/events", (c) => {
  const id = c.req.param("id");
  const job = jobs.getJob(id);
  if (!job) return c.json({ error: "Unknown job." }, 404);
  return streamSSE(c, async (stream) => {
    for (const ev of job.events) await stream.writeSSE({ data: JSON.stringify(ev) });
    if (job.status === "done" || job.status === "failed") {
      await stream.writeSSE({ data: JSON.stringify({ done: true, job: jobs.getJob(id) }) });
      return;
    }
    await new Promise<void>((resolve) => {
      const off = jobs.onJobEvent(id, (ev) => {
        void stream.writeSSE({ data: JSON.stringify("done" in ev ? { done: true, job: jobs.getJob(id) } : ev) }).then(() => {
          if ("done" in ev) { off(); resolve(); }
        });
      });
      stream.onAbort(() => { off(); resolve(); });
    });
  });
});

// ---- sessions
app.post("/api/session/new", async (c) => c.json(newSession((await c.req.json().catch(() => ({}))) as { courseIds?: string[]; size?: number }, c.req.header("x-mastery-lang") ?? c.req.header("accept-language"))));
app.post("/api/session/submit", async (c) => c.json(await submitSession((await c.req.json()) as SubmitRequest, c.req.header("x-mastery-lang") ?? c.req.header("accept-language"))));
app.get("/api/history", (c) => c.json(store.listSessions(Number(c.req.query("limit") ?? 50))));

// ---- graph
app.get("/api/graph", (c) => c.json(buildGraph(store.listCourses(), store.loadState(), store.loadSettings().graphThreshold, missedConceptsByItem())));

// ---- prompts (editable from the app)
app.get("/api/prompts", (c) => {
  const names = readdirSync(PROMPTS_DIR).filter((n) => n.endsWith(".md")).sort();
  return c.json(names.map((name) => ({ name, text: readPrompt(name) })));
});
app.put("/api/prompts/:name", async (c) => {
  const name = c.req.param("name");
  if (!/^[a-z0-9_-]+\.md$/.test(name) || !existsSync(path.join(PROMPTS_DIR, name))) return c.json({ error: "Unknown prompt." }, 404);
  const { text } = (await c.req.json()) as { text: string };
  writeFileSync(path.join(PROMPTS_DIR, name), String(text));
  return c.json({ ok: true });
});
