/**
 * The knowledge graph is derived, never stored: courses plus scheduling state in, GraphData out.
 * Only nodes that have earned their place appear. See docs/graph-threshold.md.
 */
import type { Course, GraphData, GraphLink, GraphNode, NodeState } from "@mastery/shared";
import { isLit } from "./scheduler.js";
import type { State } from "./store.js";

const MASTERED_BOX = 3; // survived a 4-day interval or longer with a passing score

function nodeState(lastScore: number, box: number, threshold: number): NodeState {
  if (lastScore >= 90 && box >= MASTERED_BOX) return "mastered";
  return lastScore >= threshold ? "lit" : "emerging";
}

export function buildGraph(courses: Course[], state: State, threshold: number, sessionsConcepts: Map<string, string[]>): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let pending = 0;
  const litItems = new Set<string>();

  for (const course of courses) {
    const topicLit = new Map<string, { lit: number; total: number; emerging: number }>();
    for (const item of course.items) {
      const st = state.items[item.id];
      const t = topicLit.get(item.topicId) ?? { lit: 0, total: 0, emerging: 0 };
      t.total += 1;
      topicLit.set(item.topicId, t);
      if (!st || st.lastScore === null) continue;
      const lit = isLit(st, item.type === "mcq", threshold);
      // The emerging band: the core idea was present (55+) but the answer would still mislead.
      const emerging = !lit && item.type !== "mcq" && st.lastScore >= 55;
      if (!lit && !emerging) { pending += 1; continue; }
      if (lit) { t.lit += 1; litItems.add(item.id); } else t.emerging += 1;
      const topic = course.topics.find((x) => x.id === item.topicId);
      nodes.push({
        id: item.id,
        kind: "item",
        domain: course.id,
        domainTitle: course.title,
        label: item.prompt.length > 70 ? `${item.prompt.slice(0, 68).trimEnd()}…` : item.prompt,
        content: item.prompt,
        abstraction: Math.min(100, (topic?.abstraction ?? 50) + 30),
        state: lit ? nodeState(st.lastScore, st.box, threshold) : "emerging",
        mastery: st.lastScore / 100,
        tags: [item.type, `difficulty ${item.difficulty}`, ...(sessionsConcepts.get(item.id) ?? [])],
        litAt: lit ? st.lastSeen ?? undefined : undefined,
        itemType: item.type,
      });
    }
    for (const topic of course.topics) {
      const t = topicLit.get(topic.id);
      if (!t || (t.lit === 0 && t.emerging === 0)) continue;
      const frac = t.total ? t.lit / t.total : 0;
      nodes.push({
        id: topic.id,
        kind: "topic",
        domain: course.id,
        domainTitle: course.title,
        label: topic.title,
        content: topic.summary,
        abstraction: topic.abstraction,
        state: t.lit === 0 ? "emerging" : frac >= 0.8 ? "mastered" : "lit",
        mastery: frac,
        tags: [`${t.lit} of ${t.total} lit`],
      });
    }
  }

  const present = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const add = (source: string, target: string, kind: GraphLink["kind"], similarity: number) => {
    if (!present.has(source) || !present.has(target) || source === target) return;
    const key = [source, target].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, kind, similarity });
  };
  for (const course of courses) {
    for (const item of course.items) {
      add(item.topicId, item.id, "member", 0.5);
      for (const p of item.prereq) add(p, item.id, "prereq", 0.8);
    }
    for (const topic of course.topics) for (const p of topic.prereq) add(p, topic.id, "prereq", 0.9);
  }
  // Shared missed concepts link items across topics and courses: what you keep confusing together.
  const byConcept = new Map<string, string[]>();
  for (const [itemId, concepts] of sessionsConcepts) {
    if (!present.has(itemId)) continue;
    for (const c of concepts) {
      const k = c.toLowerCase().trim();
      if (k.length < 4) continue;
      byConcept.set(k, [...(byConcept.get(k) ?? []), itemId]);
    }
  }
  for (const ids of byConcept.values()) {
    const unique = [...new Set(ids)].slice(0, 8);
    for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) add(unique[i]!, unique[j]!, "concept", 1);
  }

  return { nodes, links, threshold, pending };
}
