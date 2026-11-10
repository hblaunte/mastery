/**
 * Runtime configuration. Everything is an environment variable with a sensible default, so
 * retuning never means editing code. See .env.example at the repo root.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: apps/server/src → ../../.. */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

/** Minimal .env reader. Real environment variables always win. */
export function loadDotenv(file = path.join(REPO_ROOT, ".env")): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv();

/**
 * Where things live. Each is overridable so the desktop shell can point the same server at the
 * OS's per-user application folder and at the resources packed inside the app bundle.
 */
export const DATA_DIR = path.resolve(REPO_ROOT, process.env.MASTERY_DATA_DIR ?? "data");
export const PROMPTS_DIR = path.resolve(REPO_ROOT, process.env.MASTERY_PROMPTS_DIR ?? "prompts");
export const WEB_DIST = path.resolve(REPO_ROOT, process.env.MASTERY_WEB_DIST ?? path.join("apps", "web", "dist"));
/** Port 0 asks the OS for a free one; the desktop shell does this so it never collides. */
export const PORT = Number(process.env.MASTERY_PORT ?? 8787);
export const HOST = process.env.MASTERY_HOST ?? "127.0.0.1";

/**
 * A per-launch secret. When set, every /api request must carry it in the x-mastery-token header,
 * so a web page open in another tab cannot drive the local server. The desktop shell mints one
 * at launch and attaches it to its own window's requests; browsers running the dev build do not
 * need one.
 */
export const TOKEN = process.env.MASTERY_TOKEN || null;

/** A managed key the operator can offer. Never sent to the browser. */
export const MANAGED_KEY = process.env.MASTERY_MANAGED_KEY || null;

/**
 * Two tiers, then per-job overrides. The jobs are not equally hard: applying a rubric and
 * telling a right mechanism from fluent prose is a strong-tier job; comparing a few sentences
 * of recall against an answer key is not.
 */
export const STRONG = process.env.MASTERY_MODEL ?? "claude-opus-5-5";
export const CHEAP = process.env.MASTERY_MODEL_CHEAP ?? "claude-sonnet-5-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type JobKind = "essay" | "experiment" | "recall" | "calibration" | "outline" | "items" | "ocr";

const TABLE: Record<JobKind, { model: string; effort: Effort; prompt: string }> = {
  essay: { model: STRONG, effort: "high", prompt: "grade-essay.md" },
  experiment: { model: STRONG, effort: "high", prompt: "grade-experiment.md" },
  recall: { model: CHEAP, effort: "medium", prompt: "grade-recall.md" },
  calibration: { model: CHEAP, effort: "medium", prompt: "calibration-review.md" },
  outline: { model: STRONG, effort: "high", prompt: "build-outline.md" },
  items: { model: STRONG, effort: "high", prompt: "build-items.md" },
  // Transcribing scanned pages is reading, not judgement: the cheap tier at low effort.
  ocr: { model: CHEAP, effort: "low", prompt: "" },
};

export function route(kind: JobKind): { model: string; effort: Effort; prompt: string } {
  const base = TABLE[kind];
  const up = kind.toUpperCase();
  return {
    model: process.env[`MASTERY_MODEL_${up}`] ?? base.model,
    effort: (process.env[`MASTERY_EFFORT_${up}`] as Effort | undefined) ?? base.effort,
    prompt: base.prompt,
  };
}

/** Shown in Settings so the routing is visible rather than implied. */
export function routingSummary(): Record<string, string> {
  const out: Record<string, string> = { mcq: "scored locally, no API call" };
  for (const kind of Object.keys(TABLE) as JobKind[]) {
    const r = route(kind);
    out[kind] = `${r.model} · effort ${r.effort}`;
  }
  return out;
}

/** The score at which an item earns its node on the graph. See docs/graph-threshold.md. */
export const GRAPH_THRESHOLD_DEFAULT = clampInt(process.env.MASTERY_GRAPH_THRESHOLD, 75, 50, 95);

function clampInt(v: string | undefined, dflt: number, lo: number, hi: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
