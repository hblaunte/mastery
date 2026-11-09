/**
 * A session: pick items, hide their answers, and after submission grade everything at once,
 * update the spacing ladder, attach reading only to misses, and compute calibration.
 */
import type { Calibration, Course, GradedItem, Item, PublicItem, SessionRecord, SessionStart, SubmitRequest } from "@mastery/shared";
import { calibrationNumbers, calibrationReview, gradeSession, type CalibrationInput } from "./grader.js";
import { newId, nowIso } from "./ids.js";
import { emptyUsage, mergeUsage, summariseUsage } from "./llm.js";
import { buildSession, isLit, updateAfterGrade } from "./scheduler.js";
import * as store from "./store.js";

export class SessionError extends Error {}

/** Fields the browser must never see before an item has been graded. */
export function publicItem(item: Item, course: Course): PublicItem {
  const { answerIndex: _a, answerKey: _k, rubric: _r, grounding: _g, ...rest } = item;
  const topic = course.topics.find((t) => t.id === item.topicId);
  return { ...rest, topic: topic?.title ?? "", course: course.title };
}

export function allItems(courses: Course[]): Map<string, { item: Item; course: Course }> {
  const out = new Map<string, { item: Item; course: Course }>();
  for (const c of courses) for (const i of c.items) out.set(i.id, { item: i, course: c });
  return out;
}

export function newSession(body: { courseIds?: string[]; size?: number }): SessionStart {
  const courses = store.listCourses();
  const state = store.loadState();
  const settings = store.loadSettings();
  const lookup = allItems(courses);
  const items = new Map([...lookup].map(([id, v]) => [id, v.item]));
  const size = Math.max(3, Math.min(25, body.size ?? settings.sessionSize));
  const chosen = buildSession(items, state, size, body.courseIds?.length ? body.courseIds : undefined);
  if (!chosen.length) {
    return {
      id: newId("ses"),
      started: nowIso(),
      items: [],
      message: courses.length
        ? "Nothing is due and there is no new material in the selected courses. That is the system working: come back when items come due."
        : "No courses yet. Drop a source into the library and build one.",
    };
  }
  return {
    id: newId("ses"),
    started: nowIso(),
    items: chosen.map((id) => publicItem(lookup.get(id)!.item, lookup.get(id)!.course)),
  };
}

/** Latest missed concepts per item across the session record, for concept links on the graph. */
export function missedConceptsByItem(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of store.listSessions()) {
    for (const r of s.responses) if (!out.has(r.id) && r.missedConcepts.length) out.set(r.id, r.missedConcepts.slice(0, 4));
  }
  return out;
}

export async function submitSession(body: SubmitRequest): Promise<SessionRecord> {
  const responses = body.responses ?? [];
  if (!responses.length) throw new SessionError("No responses submitted.");
  const courses = store.listCourses();
  const lookup = allItems(courses);
  const state = store.loadState();
  const settings = store.loadSettings();
  const threshold = settings.graphThreshold;

  const missing = responses.filter((r) => !lookup.has(r.id)).map((r) => r.id);
  if (missing.length) throw new SessionError(`Unknown item ids: ${missing.join(", ")}`);

  const rows = responses.map((r) => {
    const { item, course } = lookup.get(r.id)!;
    const topic = course.topics.find((t) => t.id === item.topicId);
    const grounding = item.grounding
      .slice(0, 2)
      .map((g) => store.getChunks(g.sourceId)[g.chunk]?.text ?? "")
      .filter(Boolean)
      .join("\n\n…\n\n")
      .slice(0, 12000);
    return { item, course, topic: topic?.title ?? "", response: r.response ?? "", grounding, jolPre: r.jolPre ?? null, jolPost: r.jolPost ?? null };
  });

  const grades = await gradeSession(rows.map((r) => ({ item: r.item, response: r.response, topic: r.topic, course: r.course.title, grounding: r.grounding })));

  const graded: GradedItem[] = rows.map((r, i) => {
    const { grade } = grades[i]!;
    const st = store.itemState(state, r.item.id);
    const wasLit = isLit(st, r.item.type === "mcq", threshold);
    if (grade.score !== null) updateAfterGrade(st, grade.score, r.item.type !== "mcq");
    const lit = isLit(st, r.item.type === "mcq", threshold);
    // Turn "here is what you missed" into "here is where to read about it", only for a miss.
    const reading =
      grade.score !== null && grade.score < threshold
        ? r.item.grounding.slice(0, 3).map((g) => ({ sourceId: g.sourceId, title: store.getSource(g.sourceId)?.title ?? "Source", locator: g.locator, chunk: g.chunk }))
        : [];
    return {
      ...grade,
      id: r.item.id,
      courseId: r.course.id,
      course: r.course.title,
      topicId: r.item.topicId,
      topic: r.topic,
      type: r.item.type,
      difficulty: r.item.difficulty,
      prompt: r.item.prompt,
      choices: r.item.choices,
      answerIndex: r.item.answerIndex,
      answerKey: r.item.answerKey,
      rubric: r.item.rubric ?? [],
      bridge: r.item.bridge,
      response: r.response,
      jolPre: r.jolPre,
      jolPost: r.jolPost,
      reading,
      graph: { lit, newlyLit: lit && !wasLit },
    };
  });

  const scored = graded.filter((g) => g.score !== null);
  const meanScore = scored.length ? Math.round(scored.reduce((a, g) => a + (g.score ?? 0), 0) / scored.length) : null;
  const inputs: CalibrationInput[] = scored.map((g) => ({
    id: g.id, topic: g.topic, course: g.course, type: g.type, difficulty: g.difficulty,
    jolPre: g.jolPre, jolPost: g.jolPost, score: g.score!, missedConcepts: g.missedConcepts,
  }));
  const numbers = calibrationNumbers(inputs);
  let calibration: Calibration = { meanScore, bias: numbers.bias, resolution: numbers.resolution, foresightItems: [] };
  let usage = summariseUsage(grades.map((g) => g.usage));
  if (scored.length) {
    try {
      const { result, usage: cu } = await calibrationReview(inputs, store.calibrationHistory(), numbers);
      calibration = { ...calibration, foresightItems: result.foresight_items, report: result.report, recommendations: result.recommendations };
      usage = mergeUsage(usage, summariseUsage([cu]));
    } catch (err) {
      calibration.error = err instanceof Error ? err.message : String(err);
    }
  }

  const record: SessionRecord = {
    id: body.id || newId("ses"),
    started: body.started ?? null,
    finished: nowIso(),
    courseIds: [...new Set(graded.map((g) => g.courseId))],
    responses: graded,
    calibration,
    usage: usage.calls ? usage : emptyUsage(),
  };
  store.saveSession(record);
  store.saveState(state);
  return record;
}
