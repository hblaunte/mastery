/**
 * Course builds run in the background and report progress as events. Jobs live in memory while
 * running and are persisted on completion; the SSE endpoint streams events as they happen.
 */
import { EventEmitter } from "node:events";
import type { BuildCourseRequest, Job, JobEvent } from "@mastery/shared";
import { PROMPTS_DIR, route } from "./config.js";
import { buildCourse } from "./generate/index.js";
import { newId, nowIso } from "./ids.js";
import { client, emptyUsage } from "./llm.js";
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

export function startBuild(req: BuildCourseRequest): Job {
  const job: Job = { id: newId("job"), kind: "build-course", status: "queued", created: nowIso(), events: [], usage: emptyUsage() };
  running.set(job.id, job);
  const emit = (message: string, progress: number) => {
    const ev: JobEvent = { at: nowIso(), message, progress: Math.max(0, Math.min(1, progress)) };
    job.events.push(ev);
    bus.emit(job.id, ev);
  };
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
          const source = store.getSource(id);
          if (!source) throw new Error(`Unknown source ${id}`);
          return { source, chunks: store.getChunks(id) };
        },
        onEvent: emit,
        newId,
        signal: controller.signal,
      });
      store.saveCourse(course);
      job.usage = usage;
      job.courseId = course.id;
      job.status = "done";
      emit(`Built "${course.title}": ${course.topics.length} topics, ${course.items.length} items`, 1);
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      emit(`Failed: ${job.error}`, 1);
    } finally {
      job.finished = nowIso();
      store.saveJob(job);
      running.delete(job.id);
      bus.emit(job.id, { done: true });
    }
  })();
  return job;
}
