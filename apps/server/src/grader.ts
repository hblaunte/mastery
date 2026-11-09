/**
 * Grading. Multiple choice is scored locally; everything else goes to the model with a rubric,
 * an answer key and a JSON schema. See llm.ts for routing and caching.
 */
import type { Grade, Item, Quote, RubricScore } from "@mastery/shared";
import { route } from "./config.js";
import { callStructured, type CallUsage } from "./llm.js";

export const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    rubric_scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          verdict: { type: "string", enum: ["met", "partial", "absent"] },
          note: { type: "string" },
        },
        required: ["criterion", "verdict", "note"],
        additionalProperties: false,
      },
    },
    feedback: { type: "string" },
    probe: { anyOf: [{ type: "string" }, { type: "null" }] },
    missed_concepts: { type: "array", items: { type: "string" } },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: ["good", "weak", "wrong"] },
          why: { type: "string" },
        },
        required: ["text", "kind", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["score", "rubric_scores", "feedback", "probe", "missed_concepts", "quotes"],
  additionalProperties: false,
} as const;

interface RawGrade {
  score: number;
  rubric_scores: RubricScore[];
  feedback: string;
  probe: string | null;
  missed_concepts: string[];
  quotes: Quote[];
}

export interface GradeResult { grade: Grade; usage: CallUsage | null }

function gradeMcq(item: Item, response: string): GradeResult {
  const picked = Number.parseInt(response, 10);
  const correct = item.answerIndex ?? -1;
  const choices = item.choices ?? [];
  const right = picked === correct;
  let feedback: string;
  if (right) feedback = "Correct.";
  else if (picked >= 0 && picked < choices.length) feedback = `Incorrect. You chose: ${choices[picked]}\n\nThe answer is: ${choices[correct]}\n\n${item.answerKey ?? ""}`.trim();
  else feedback = `No answer recorded.\n\nThe answer is: ${choices[correct] ?? "?"}`;
  return {
    grade: { score: right ? 100 : 0, rubricScores: [], feedback, probe: null, missedConcepts: right ? [] : [topicLabel(item)], quotes: [], gradedBy: "local" },
    usage: null,
  };
}

function gradeBlank(item: Item): GradeResult {
  return {
    grade: {
      score: 0,
      rubricScores: [],
      feedback: "No answer given. Skipped items are recorded as zero. That is data, not a judgement.",
      probe: null,
      missedConcepts: [topicLabel(item)],
      quotes: [],
      gradedBy: "local",
    },
    usage: null,
  };
}

function topicLabel(item: Item): string {
  return item.prompt.slice(0, 60);
}

async function gradeRemote(item: Item, response: string, topic: string, course: string, grounding: string): Promise<GradeResult> {
  const kind = item.type === "essay" || item.type === "experiment" ? item.type : "recall";
  const payload = {
    course,
    topic,
    type: item.type,
    difficulty: item.difficulty,
    prompt: item.prompt,
    answer_key: item.answerKey ?? "",
    rubric: item.rubric ?? [],
    bridge: item.bridge ?? null,
    source_passage: grounding,
    response,
  };
  const user = `Grade the following response.\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  const { result, usage } = await callStructured<RawGrade>({ kind, user, schema: GRADE_SCHEMA as unknown as Record<string, unknown> });
  return {
    grade: {
      score: Math.max(0, Math.min(100, Math.round(result.score))),
      rubricScores: result.rubric_scores,
      feedback: result.feedback,
      probe: result.probe,
      missedConcepts: result.missed_concepts,
      // A span the grader invents rather than copies is dropped rather than approximated.
      quotes: result.quotes.filter((q) => q.text.trim() && response.includes(q.text)),
      gradedBy: usage.model,
    },
    usage,
  };
}

export interface ToGrade { item: Item; response: string; topic: string; course: string; grounding: string }

/**
 * Grade every response, preserving input order.
 *
 * Ordering matters for cost. A cache entry only becomes readable once the response that wrote
 * it has started streaming, so firing every request at once means each pays the full uncached
 * price. Instead: grade the first item of each distinct (model, kind) group on its own to write
 * the cache, then fan the rest out in parallel to read it. A failure on one item is captured in
 * place rather than losing the session.
 */
export async function gradeSession(rows: ToGrade[], workers = 4): Promise<GradeResult[]> {
  const results: (GradeResult | null)[] = rows.map(() => null);
  const groups = new Map<string, number[]>();
  rows.forEach((row, idx) => {
    if (row.item.type === "mcq") results[idx] = gradeMcq(row.item, row.response);
    else if (!row.response.trim()) results[idx] = gradeBlank(row.item);
    else {
      const kind = row.item.type === "recall" ? "recall" : row.item.type;
      const key = `${route(kind).model}|${kind}`;
      groups.set(key, [...(groups.get(key) ?? []), idx]);
    }
  });

  const safe = async (idx: number): Promise<GradeResult> => {
    const r = rows[idx]!;
    try {
      return await gradeRemote(r.item, r.response, r.topic, r.course, r.grounding);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        grade: { score: null, rubricScores: [], feedback: `Grading failed for this item: ${msg}`, probe: null, missedConcepts: [], quotes: [], gradedBy: "error", error: msg },
        usage: null,
      };
    }
  };

  const remainder: number[] = [];
  for (const indices of groups.values()) {
    results[indices[0]!] = await safe(indices[0]!);
    remainder.push(...indices.slice(1));
  }
  // Bounded parallelism over the rest.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, remainder.length) }, async () => {
      while (cursor < remainder.length) {
        const idx = remainder[cursor++]!;
        results[idx] = await safe(idx);
      }
    }),
  );
  return results.map((r) => r!);
}

// ---------------------------------------------------------------- calibration

export const CALIBRATION_SCHEMA = {
  type: "object",
  properties: {
    foresight_items: { type: "array", items: { type: "string" } },
    report: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["foresight_items", "report", "recommendations"],
  additionalProperties: false,
} as const;

export interface CalibrationInput {
  id: string; topic: string; course: string; type: string; difficulty: number;
  jolPre: number | null; jolPost: number | null; score: number; missedConcepts: string[];
}

/** Bias and resolution are arithmetic; compute them here so the numbers never depend on the model. */
export function calibrationNumbers(rows: CalibrationInput[]): { bias: number | null; resolution: number | null } {
  const paired = rows.filter((r) => r.jolPre !== null);
  if (!paired.length) return { bias: null, resolution: null };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pre = paired.map((r) => r.jolPre!);
  const sc = paired.map((r) => r.score);
  const bias = Math.round((mean(pre) - mean(sc)) * 10) / 10;
  if (paired.length < 4) return { bias, resolution: null };
  const mp = mean(pre), ms = mean(sc);
  const cov = pre.reduce((a, p, i) => a + (p - mp) * (sc[i]! - ms), 0);
  const vp = pre.reduce((a, p) => a + (p - mp) ** 2, 0);
  const vs = sc.reduce((a, s) => a + (s - ms) ** 2, 0);
  const resolution = vp > 0 && vs > 0 ? Math.round((cov / Math.sqrt(vp * vs)) * 100) / 100 : null;
  return { bias, resolution };
}

export async function calibrationReview(rows: CalibrationInput[], history: unknown[], numbers: { bias: number | null; resolution: number | null }) {
  const user = `Produce the calibration review for this session.\n\n\`\`\`json\n${JSON.stringify({ computed: numbers, session: rows, history }, null, 2)}\n\`\`\``;
  return callStructured<{ foresight_items: string[]; report: string; recommendations: string[] }>({
    kind: "calibration",
    user,
    schema: CALIBRATION_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 8000,
  });
}
