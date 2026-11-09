/**
 * Session construction, grounded in Bjork, Dunlosky & Kornell (2013).
 *
 *   Retrieval over restudy   Every scheduled event is a retrieval attempt. There is no "review
 *                            the material" state.
 *   Expanding spacing        Intervals grow on success and collapse on failure.
 *   Interleaving             Consecutive items come from different courses wherever the due set
 *                            allows. Blocking feels more fluent and teaches less.
 *   Generation first         An item is never accompanied by its source until it has been
 *                            attempted and graded.
 */
import type { Item, ItemState, TrackStats } from "@mastery/shared";
import { itemState, type State } from "./store.js";
import { nowIso, todayIso } from "./ids.js";

/** Interval ladder in days. Shallow at the start: early successes are the least reliable evidence. */
export const LADDER = [1, 2, 4, 8, 16, 32, 64, 120];
/** A score at or above this counts as successful retrieval and advances the box. */
export const PASS = 70;
/** Below this is a lapse: the box resets rather than stepping back one. */
export const LAPSE = 45;

function dueDate(box: number, from = new Date()): string {
  const days = LADDER[Math.max(0, Math.min(box, LADDER.length - 1))] ?? 1;
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Advance, hold, or reset an item's position on the ladder. */
export function updateAfterGrade(st: ItemState, score: number, produced: boolean): ItemState {
  st.seen += 1;
  st.lastScore = score;
  st.scores = [...st.scores.slice(-9), score];
  st.lastSeen = nowIso();
  if (produced) st.lastProducedScore = score;
  if (score >= PASS) st.box = Math.min(st.box + 1, LADDER.length - 1);
  else if (score < LAPSE) {
    // A genuine failure sends it back to the start. Partial credit (45–69) holds position: the
    // retrieval partly succeeded, so the interval that produced it was roughly right.
    st.box = 0;
    st.lapses += 1;
  }
  st.due = dueDate(st.box);
  // Retire an item once it has been produced cleanly from a long interval.
  if (st.box >= LADDER.length - 1 && score >= 90) st.retired = true;
  return st;
}

function pool(items: Map<string, Item>, state: State, courseIds?: string[]) {
  const today = todayIso();
  const due: string[] = [];
  const fresh: string[] = [];
  for (const [id, item] of items) {
    if (courseIds?.length && !courseIds.includes(item.courseId)) continue;
    const st = itemState(state, id);
    if (st.retired) continue;
    if (st.due === null) {
      // Never seen. Gate on prerequisites so dependency order holds.
      const ok = item.prereq.every((p) => !items.has(p) || (state.items[p]?.seen ?? 0) > 0);
      if (ok) fresh.push(id);
    } else if (st.due <= today) due.push(id);
  }
  return { due, fresh };
}

/** Take n items from the pool, spread across courses rather than in list order. */
function takeAcross(items: Map<string, Item>, ids: string[], n: number, key: (id: string) => [number | string, number | string]): string[] {
  const by = new Map<string, string[]>();
  for (const id of ids) {
    const c = items.get(id)!.courseId;
    by.set(c, [...(by.get(c) ?? []), id]);
  }
  for (const bucket of by.values()) bucket.sort((a, b) => cmp(key(a), key(b)));
  const out: string[] = [];
  while (out.length < n && [...by.values()].some((b) => b.length)) {
    for (const c of [...by.keys()].sort((a, b) => (by.get(b)?.length ?? 0) - (by.get(a)?.length ?? 0))) {
      const bucket = by.get(c)!;
      if (bucket.length && out.length < n) out.push(bucket.shift()!);
    }
  }
  return out;
}
function cmp(a: [number | string, number | string], b: [number | string, number | string]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/** Reorder so adjacent items come from different courses where possible. */
function interleave(items: Map<string, Item>, chosen: string[]): string[] {
  const by = new Map<string, string[]>();
  for (const id of chosen) {
    const c = items.get(id)!.courseId;
    by.set(c, shuffle([...(by.get(c) ?? []), id]));
  }
  const out: string[] = [];
  let last: string | null = null;
  while ([...by.values()].some((b) => b.length)) {
    let options = [...by.entries()].filter(([c, b]) => b.length && c !== last);
    if (!options.length) options = [...by.entries()].filter(([, b]) => b.length);
    const [course, bucket] = options.sort((a, b) => b[1].length - a[1].length)[0]!;
    out.push(bucket.pop()!);
    last = course;
  }
  return out;
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Assemble one session: overdue material first, topped up with new items. */
export function buildSession(items: Map<string, Item>, state: State, size = 8, courseIds?: string[], freshRatio = 0.35): string[] {
  const { due, fresh } = pool(items, state, courseIds);
  let nFresh = Math.max(0, Math.min(fresh.length, Math.round(size * freshRatio)));
  const nDue = Math.min(due.length, size - nFresh);
  nFresh = Math.min(fresh.length, size - nDue);

  const duePick = takeAcross(items, due, nDue, (i) => [state.items[i]!.due ?? "", -state.items[i]!.lapses]);
  const freshPick = takeAcross(items, fresh, nFresh, (i) => [items.get(i)!.difficulty, i]);
  const chosen = [...duePick, ...freshPick];
  if (!chosen.length) return [];
  let ordered = interleave(items, chosen);

  // Open on something due rather than brand new when we can; only if it costs no interleaving.
  const dueSet = new Set(duePick);
  const repeats = (seq: string[]) => seq.slice(1).filter((id, i) => items.get(id)!.courseId === items.get(seq[i]!)!.courseId).length;
  if (ordered.length && !dueSet.has(ordered[0]!)) {
    const idx = ordered.findIndex((id) => dueSet.has(id));
    if (idx > 0) {
      const candidate = [...ordered];
      candidate.unshift(candidate.splice(idx, 1)[0]!);
      if (repeats(candidate) <= repeats(ordered)) ordered = candidate;
    }
  }
  return ordered;
}

export function statsFor(items: Item[], state: State, threshold: number): TrackStats {
  const today = todayIso();
  const t: TrackStats = { total: 0, seen: 0, due: 0, retired: 0, meanScore: null, lit: 0 };
  const scores: number[] = [];
  for (const item of items) {
    const st = state.items[item.id];
    t.total += 1;
    if (!st) continue;
    if (st.seen) {
      t.seen += 1;
      if (st.lastScore !== null) scores.push(st.lastScore);
    }
    if (st.retired) t.retired += 1;
    else if (st.due && st.due <= today) t.due += 1;
    if (isLit(st, item.type === "mcq", threshold)) t.lit += 1;
  }
  t.meanScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  return t;
}

/**
 * Whether an item has earned its node. The latest score must reach the threshold, and multiple
 * choice alone never counts as fully lit: recognising an answer is not producing it. See
 * docs/graph-threshold.md.
 */
export function isLit(st: ItemState | undefined, isMcq: boolean, threshold: number): boolean {
  if (!st || st.lastScore === null) return false;
  if (isMcq) return false;
  return st.lastScore >= threshold;
}
