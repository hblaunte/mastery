/**
 * The one place that talks to the Claude API for grading. Three decisions are encoded here:
 *
 *   Per-job routing   see config.route(). Essays get the strong tier; recall and the
 *                     calibration report go to the cheaper tier at lower effort.
 *   Prompt caching    the system prompt is byte-identical on every request of a given kind, so
 *                     it is sent with cache_control and re-read at a tenth of the input rate.
 *   Structured output every response is constrained to a JSON schema, so the grade is data, not
 *                     prose to be parsed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Usage } from "@mastery/shared";
import { PROMPTS_DIR, route, type Effort, type JobKind } from "./config.js";
import { resolveKey } from "./keys.js";
import { loadSettings } from "./store.js";

export class LlmError extends Error {}

export function hasCredentials(): boolean {
  return Boolean(resolveKey() || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function client(): Anthropic {
  const key = resolveKey();
  if (key) return new Anthropic({ apiKey: key });
  // Fall back to whatever the SDK resolves from the environment (a developer's own login).
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return new Anthropic();
  throw new LlmError("No API key yet. Add your Anthropic key in Settings, or choose the managed key.");
}

export function readPrompt(name: string): string {
  const file = path.join(PROMPTS_DIR, name);
  if (!existsSync(file)) throw new LlmError(`Missing prompt file: prompts/${name}`);
  return readFileSync(file, "utf8");
}

/**
 * Shared preamble plus the job-specific prompt. Re-read on every call so the prompts can be
 * edited without a restart. The result is deterministic for a given settings file, which is what
 * makes it cacheable.
 */
export function systemFor(kind: JobKind, languageNote = ""): string {
  const { prompt } = route(kind);
  const background = loadSettings().background.trim();
  const preamble = readPrompt("_system.md")
    .replace("{{background}}", background || "The learner has not described their background. Grade against the sources alone.")
    .replace("{{language}}", languageNote);
  return `${preamble}\n\n---\n\n${readPrompt(prompt)}`;
}

export interface CallUsage { model: string; effort: Effort; input: number; output: number; cacheWrite: number; cacheRead: number }

export async function callStructured<T>(opts: {
  kind: JobKind;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  languageNote?: string;
}): Promise<{ result: T; usage: CallUsage }> {
  const { model, effort } = route(opts.kind);
  const system = systemFor(opts.kind, opts.languageNote);
  let message: Anthropic.Message;
  try {
    message = await client()
      .messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 16000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        output_config: { effort, format: { type: "json_schema", schema: opts.schema } },
        messages: [{ role: "user", content: opts.user }],
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic rejected the API key. Check it in Settings.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new LlmError("This key is not allowed to use the model. Check it in Settings.");
    if (err instanceof Anthropic.RateLimitError) throw new LlmError("Rate limited by the API. Wait a minute and try again.");
    if (err instanceof Anthropic.APIConnectionError) throw new LlmError("Could not reach the Anthropic API.");
    if (err instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error ${err.status}: ${err.message}`);
    throw err;
  }
  if (message.stop_reason === "refusal") throw new LlmError("The grader declined to respond to this item.");
  if (message.stop_reason === "max_tokens") throw new LlmError("The grader ran out of room. Try again.");
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new LlmError("The grader returned no text.");
  const u = message.usage;
  return {
    result: JSON.parse(text) as T,
    usage: {
      model,
      effort,
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    },
  };
}

/** Published per-million-token rates (input, output). Indicative; the invoice is the invoice. */
export const RATES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0, perModel: {}, cacheHitRatio: 0, estimatedCost: 0 };
}

/** Roll up per-call usage so the cost of a session is visible, not guessed. */
export function summariseUsage(calls: (CallUsage | null | undefined)[]): Usage {
  const total = emptyUsage();
  for (const u of calls) {
    if (!u) continue;
    total.calls += 1;
    const m = (total.perModel[u.model] ??= { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    m.calls += 1;
    for (const k of ["input", "output", "cacheWrite", "cacheRead"] as const) {
      total[k] += u[k];
      m[k] += u[k];
    }
  }
  const cacheable = total.cacheRead + total.cacheWrite;
  total.cacheHitRatio = cacheable ? Math.round((total.cacheRead / cacheable) * 100) / 100 : 0;
  total.estimatedCost = estimateCost(total);
  return total;
}

export function estimateCost(usage: Usage): number {
  let cost = 0;
  for (const [model, u] of Object.entries(usage.perModel)) {
    const [inRate, outRate] = RATES[model] ?? [5, 25];
    cost += (u.input * inRate + u.cacheWrite * inRate * 1.25 + u.cacheRead * inRate * 0.1 + u.output * outRate) / 1e6;
  }
  return Math.round(cost * 10000) / 10000;
}

export function mergeUsage(a: Usage, b: Usage): Usage {
  const out = emptyUsage();
  for (const u of [a, b]) {
    out.calls += u.calls;
    for (const k of ["input", "output", "cacheWrite", "cacheRead"] as const) out[k] += u[k];
    for (const [model, m] of Object.entries(u.perModel)) {
      const t = (out.perModel[model] ??= { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
      t.calls += m.calls;
      for (const k of ["input", "output", "cacheWrite", "cacheRead"] as const) t[k] += m[k];
    }
  }
  const cacheable = out.cacheRead + out.cacheWrite;
  out.cacheHitRatio = cacheable ? Math.round((out.cacheRead / cacheable) * 100) / 100 : 0;
  out.estimatedCost = estimateCost(out);
  return out;
}
