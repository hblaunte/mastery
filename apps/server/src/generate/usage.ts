/**
 * Token accounting for a build. Rates are USD per million tokens (input / output);
 * cache reads bill at 0.1x input, cache writes at 1.25x input.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "@mastery/shared";

export const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
export const UNKNOWN_RATE = { input: 5, output: 25 };

/** Exact match first, then the longest known id that prefixes the model string (date suffixes, provider prefixes). */
export function rateFor(model: string): { input: number; output: number } {
  const exact = RATES[model];
  if (exact) return exact;
  let best: string | undefined;
  for (const id of Object.keys(RATES)) {
    if ((model.startsWith(id) || model.includes(id)) && (!best || id.length > best.length)) best = id;
  }
  return best ? RATES[best]! : UNKNOWN_RATE;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0, perModel: {}, cacheHitRatio: 0, estimatedCost: 0 };
}

/** Add one response's usage. Mutates and returns `acc`. */
export function addUsage(acc: Usage, model: string, u: Anthropic.Usage | undefined | null): Usage {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  acc.input += input;
  acc.output += output;
  acc.cacheWrite += cacheWrite;
  acc.cacheRead += cacheRead;
  acc.calls += 1;
  const pm = acc.perModel[model] ?? { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  pm.calls += 1; pm.input += input; pm.output += output; pm.cacheWrite += cacheWrite; pm.cacheRead += cacheRead;
  acc.perModel[model] = pm;
  return finalizeUsage(acc);
}

/** Recompute the derived fields (hit ratio and cost) from the per-model totals. */
export function finalizeUsage(acc: Usage): Usage {
  const promptTokens = acc.input + acc.cacheWrite + acc.cacheRead;
  acc.cacheHitRatio = promptTokens > 0 ? acc.cacheRead / promptTokens : 0;
  let cost = 0;
  for (const [model, pm] of Object.entries(acc.perModel)) {
    const r = rateFor(model);
    cost += (pm.input * r.input + pm.cacheWrite * r.input * 1.25 + pm.cacheRead * r.input * 0.1 + pm.output * r.output) / 1_000_000;
  }
  acc.estimatedCost = Math.round(cost * 1_000_000) / 1_000_000;
  return acc;
}
