import type {
  AppState, BuildCourseRequest, Course, CourseSummary, GraphData, Job, JobEvent, KeyStatus, PublicItem, SessionRecord,
  SessionStart, Settings, Source, SourceChunk, SubmitRequest,
} from "@mastery/shared";
import { activeLang, tr } from "./i18n";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // The server writes its own messages (build progress, local verdicts, errors) in the interface language.
  const headers = new Headers(init?.headers);
  headers.set("x-mastery-lang", activeLang());
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? tr("Request failed ({status})", { status: res.status });
    throw new ApiError(msg, res.status);
  }
  return data as T;
}
const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type CourseDetail = Omit<Course, "items"> & { items: (PublicItem & { state: import("@mastery/shared").ItemState | null })[] };

export const api = {
  state: () => call<AppState>("/api/state"),
  settings: (patch: Partial<Settings>) => call<Settings>("/api/settings", json(patch, "PUT")),
  keys: () => call<KeyStatus>("/api/keys"),
  setKey: (body: { mode: "byok"; key: string } | { mode: "managed" } | { mode: "none" }) => call<KeyStatus>("/api/keys", json(body, "PUT")),
  validateKey: () => call<KeyStatus>("/api/keys/validate", { method: "POST" }),
  library: () => call<Source[]>("/api/library"),
  upload: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name);
    return call<Source[]>("/api/library", { method: "POST", body: form });
  },
  addUrl: (url: string) => call<Source>("/api/library/url", json({ url })),
  chunks: (id: string) => call<{ chunks: SourceChunk[] }>(`/api/library/${encodeURIComponent(id)}/text`),
  chunk: (id: string, n: number) => call<SourceChunk>(`/api/library/${encodeURIComponent(id)}/text?chunk=${n}`),
  deleteSource: (id: string) => call<{ ok: true }>(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" }),
  markdown: (id: string) => call<{ markdown: string }>(`/api/library/${encodeURIComponent(id)}/markdown`),
  saveMarkdown: (id: string, markdown: string) => call<Source>(`/api/library/${encodeURIComponent(id)}/markdown`, json({ markdown }, "PUT")),
  ocr: (id: string) => call<Job>(`/api/library/${encodeURIComponent(id)}/ocr`, { method: "POST" }),
  courses: () => call<CourseSummary[]>("/api/courses"),
  course: (id: string) => call<CourseDetail>(`/api/courses/${encodeURIComponent(id)}`),
  deleteCourse: (id: string) => call<{ ok: true }>(`/api/courses/${encodeURIComponent(id)}`, { method: "DELETE" }),
  build: (req: BuildCourseRequest) => call<Job>("/api/courses/build", json(req)),
  job: (id: string) => call<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  newSession: (body: { courseIds?: string[]; size?: number }) => call<SessionStart>("/api/session/new", json(body)),
  submit: (body: SubmitRequest) => call<SessionRecord>("/api/session/submit", json(body)),
  history: (limit = 50) => call<SessionRecord[]>(`/api/history?limit=${limit}`),
  graph: () => call<GraphData>("/api/graph"),
  prompts: () => call<{ name: string; text: string }[]>("/api/prompts"),
  savePrompt: (name: string, text: string) => call<{ ok: true }>(`/api/prompts/${encodeURIComponent(name)}`, json({ text }, "PUT")),
};

/** Follow a build job's events until it finishes. Returns the final job. */
export function watchJob(id: string, onEvent: (ev: JobEvent) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
    es.onmessage = (m) => {
      const data = JSON.parse(m.data) as JobEvent | { done: true; job: Job };
      if ("done" in data) { es.close(); resolve(data.job); } else onEvent(data);
    };
    es.onerror = () => {
      es.close();
      // The stream can drop on long builds; fall back to polling.
      const poll = async () => {
        try {
          const job = await api.job(id);
          if (job.status === "done" || job.status === "failed") resolve(job);
          else setTimeout(poll, 2000);
        } catch (e) { reject(e); }
      };
      void poll();
    };
  });
}
