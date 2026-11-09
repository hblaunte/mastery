/**
 * Persistence. Everything is plain JSON on disk so it survives, diffs and greps.
 *
 *   data/library/                   sources as Markdown with frontmatter (library.ts)
 *   data/courses/<id>.json          Course (with answer keys; never served whole)
 *   data/state.json                 per-item scheduling state
 *   data/sessions/<stamp>-<id>.json one record per session, never rewritten
 *   data/settings.json              learner settings
 *   data/jobs/<id>.json             course builds, for history
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CalibrationPoint, Course, ItemState, Job, SessionRecord, Settings } from "@mastery/shared";
import { DATA_DIR, GRAPH_THRESHOLD_DEFAULT, routingSummary } from "./config.js";
import { nowIso } from "./ids.js";

const dirs = {
  courses: path.join(DATA_DIR, "courses"),
  sessions: path.join(DATA_DIR, "sessions"),
  jobs: path.join(DATA_DIR, "jobs"),
};
const STATE = path.join(DATA_DIR, "state.json");
const SETTINGS = path.join(DATA_DIR, "settings.json");

export function ensureDirs(): void {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
}

/** Write via temp file + rename so an interrupted write cannot truncate state. */
function atomicWrite(file: string, payload: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function listJson<T>(dir: string, filter = (name: string) => name.endsWith(".json")): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(filter)
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as T);
}

// ------------------------------------------------------------------ sources (see library.ts)

export { listSources, getSource, getChunks, deleteSource } from "./library.js";

// ------------------------------------------------------------------ courses

export function listCourses(): Course[] {
  return listJson<Course>(dirs.courses).sort((a, b) => b.created.localeCompare(a.created));
}
export function getCourse(id: string): Course | null {
  return readJson<Course>(path.join(dirs.courses, `${safe(id)}.json`));
}
export function saveCourse(course: Course): void {
  atomicWrite(path.join(dirs.courses, `${safe(course.id)}.json`), course);
}
export function deleteCourse(id: string): boolean {
  const file = path.join(dirs.courses, `${safe(id)}.json`);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

// ------------------------------------------------------------------ scheduling state

export interface State { items: Record<string, ItemState>; created: string }

export function loadState(): State {
  return readJson<State>(STATE) ?? { items: {}, created: nowIso() };
}
export function saveState(state: State): void {
  atomicWrite(STATE, state);
}
/** Scheduling state for one item, created on first sight. */
export function itemState(state: State, id: string): ItemState {
  return (state.items[id] ??= {
    box: 0,
    due: null,
    seen: 0,
    lapses: 0,
    lastScore: null,
    scores: [],
    lastSeen: null,
    retired: false,
    lastProducedScore: null,
  });
}

// ------------------------------------------------------------------ sessions

export function saveSession(record: SessionRecord): void {
  const stamp = record.finished.replace(/[-:]/g, "");
  atomicWrite(path.join(dirs.sessions, `${stamp}-${safe(record.id)}.json`), record);
}
export function listSessions(limit?: number): SessionRecord[] {
  const all = listJson<SessionRecord>(dirs.sessions).reverse();
  return limit ? all.slice(0, limit) : all;
}
/** Compact per-session calibration record, oldest first, for trend analysis. */
export function calibrationHistory(): CalibrationPoint[] {
  const out: CalibrationPoint[] = [];
  for (const s of listSessions().reverse()) {
    const c = s.calibration;
    if (c && c.bias != null) {
      out.push({ finished: s.finished, items: s.responses.length, bias: c.bias, resolution: c.resolution, meanScore: c.meanScore });
    }
  }
  return out;
}

// ------------------------------------------------------------------ settings

export function loadSettings(): Settings {
  const saved = readJson<Partial<Settings>>(SETTINGS) ?? {};
  return {
    graphThreshold: saved.graphThreshold ?? GRAPH_THRESHOLD_DEFAULT,
    sessionSize: saved.sessionSize ?? 8,
    background: saved.background ?? "",
    onboardingDone: saved.onboardingDone ?? false,
    routing: routingSummary(),
  };
}
export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings();
  const next: Settings = {
    ...current,
    ...patch,
    graphThreshold: clamp(patch.graphThreshold ?? current.graphThreshold, 50, 95),
    sessionSize: clamp(patch.sessionSize ?? current.sessionSize, 3, 25),
    background: String(patch.background ?? current.background).slice(0, 2000),
    routing: routingSummary(),
  };
  const { routing: _r, ...persist } = next;
  atomicWrite(SETTINGS, persist);
  return next;
}

// ------------------------------------------------------------------ jobs

export function saveJob(job: Job): void {
  atomicWrite(path.join(dirs.jobs, `${safe(job.id)}.json`), job);
}
export function getJob(id: string): Job | null {
  return readJson<Job>(path.join(dirs.jobs, `${safe(id)}.json`));
}

// ------------------------------------------------------------------ helpers

function safe(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`invalid id: ${id}`);
  return id;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));
}

export const DATA_DIR_RESOLVED = DATA_DIR;
