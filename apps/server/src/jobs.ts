/**
 * Course builds run in the background and report progress as events. Jobs live in memory while
 * running and are persisted on completion; the SSE endpoint streams events as they happen.
 */
import { EventEmitter } from "node:events";
import type { BuildCourseRequest, Job, JobEvent } from "@mastery/shared";
import { PROMPTS_DIR, route } from "./config.js";
import { buildCourse } from "./generate/index.js";
import { mergeOcr, ocrPdfPages } from "./ingest/index.js";
import * as library from "./library.js";
import { newId, nowIso } from "./ids.js";
import { client, emptyUsage, summariseUsage } from "./llm.js";
import * as store from "./store.js";

const running = new Map<string, Job>();
const bus = new EventEmitter();
bus.setMaxListeners(100);

export function getJob(id: string): Job | null {
  return running.get(id) ?? store.getJob(id);
}

export function onJobEvent(id: string, fn: (ev: JobEvent | { done: true }) => void): () => void {
  bus.on(id, fn);
  return () => bus.off(id, fn);
}

function open(kind: Job["kind"]): { job: Job; emit: (message: string, progress: number) => void; finish: () => void } {
  const job: Job = { id: newId("job"), kind, status: "queued", created: nowIso(), events: [], usage: emptyUsage() };
  running.set(job.id, job);
  const emit = (message: string, progress: number) => {
    const ev: JobEvent = { at: nowIso(), message, progress: Math.max(0, Math.min(1, progress)) };
    job.events.push(ev);
    bus.emit(job.id, ev);
  };
  const finish = () => {
    job.finished = nowIso();
    store.saveJob(job);
    running.delete(job.id);
    bus.emit(job.id, { done: true });
  };
  return { job, emit, finish };
}

/** Transcribe a PDF's scanned pages with the model and merge them into its Markdown page. */
export function startOcr(sourceId: string): Job {
  const { job, emit, finish } = open("ocr");
  job.sourceId = sourceId;
  void (async () => {
    job.status = "running";
    try {
      const source = library.getSource(sourceId);
      const raw = library.getRaw(sourceId);
      const markdown = library.getMarkdown(sourceId);
      if (!source || !raw || markdown === null) throw new Error("The source or its original file is missing.");
      const pages = source.needsOcr ?? [];
      emit(`Transcribing ${pages.length} scanned pages`, 0.02);
      const { model } = route("ocr");
      const result = await ocrPdfPages(raw.bytes, pages, { client: client(), model, onEvent: emit });
      const merged = mergeOcr(markdown, result.text);
      library.updateMarkdown(sourceId, merged, { method: pages.length >= (source.pages ?? 0) ? "ocr" : "mixed", needsOcr: undefined, warning: undefined }, "ocr");
      job.usage = summariseUsage(result.usage.map((u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) => ({ model: result.model, effort: "low" as const, input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 })));
      job.status = "done";
      emit(`Transcribed ${pages.length} pages · about $${job.usage.estimatedCost.toFixed(2)}`, 1);
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      emit(`Failed: ${job.error}`, 1);
    } finally {
      finish();
    }
  })();
  return job;
}

export function startBuild(req: BuildCourseRequest): Job {
  const { job, emit, finish } = open("build-course");
  const controller = new AbortController();
  void (async () => {
    job.status = "running";
    emit("Starting", 0);
    try {
      const { model, effort } = route("outline");
      const { course, usage } = await buildCourse(req, {
        client: client(),
        model,
        effort,
        promptsDir: PROMPTS_DIR,
        readSource: async (id: string) => {
          const source = library.getSource(id);
          if (!source) throw new Error(`Unknown source ${id}`);
          return { source, chunks: library.getChunks(id) };
        },
        onEvent: emit,
        newId,
        signal: controller.signal,
      });
      store.saveCourse(course);
      library.log(`build | ${course.title} | ${course.topics.length} topics · ${course.items.length} items | about $${usage.estimatedCost.toFixed(2)}`);
      job.usage = usage;
      job.courseId = course.id;
      job.status = "done";
      emit(`Built "${course.title}": ${course.topics.length} topics, ${course.items.length} items`, 1);
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      emit(`Failed: ${job.error}`, 1);
    } finally {
      finish();
    }
  })();
  return job;
}
