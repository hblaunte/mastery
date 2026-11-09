/**
 * Demo data for smoke-testing the graph without a server: three courses, six
 * topics, eighteen items across the three states, forty links of mixed kinds.
 */

import type { GraphData, GraphLink, GraphNode, ItemType, NodeState } from "@mastery/shared";

const COURSES = [
  { id: "c-bayes", title: "Statistical Rethinking" },
  { id: "c-augur", title: "Augur v3" },
  { id: "c-cells", title: "Cell Biology" },
] as const;

type CourseId = (typeof COURSES)[number]["id"];

const titleOf: Record<CourseId, string> = Object.fromEntries(COURSES.map((c) => [c.id, c.title])) as Record<CourseId, string>;

function topic(id: string, domain: CourseId, label: string, content: string, abstraction: number, mastery: number, tags: string[]): GraphNode {
  const state: NodeState = mastery >= 0.85 ? "mastered" : mastery >= 0.5 ? "lit" : "emerging";
  return { id, kind: "topic", domain, domainTitle: titleOf[domain], label, content, abstraction, state, mastery, tags };
}

function item(
  id: string,
  domain: CourseId,
  label: string,
  content: string,
  state: NodeState,
  mastery: number,
  itemType: ItemType,
  tags: string[],
  litAt?: string,
): GraphNode {
  return { id, kind: "item", domain, domainTitle: titleOf[domain], label, content, abstraction: 80 + ((id.length * 7) % 18), state, mastery, tags, litAt, itemType };
}

function link(source: string, target: string, kind: GraphLink["kind"], similarity: number): GraphLink {
  return { source, target, kind, similarity };
}

export function demoGraph(): GraphData {
  const nodes: GraphNode[] = [
    // ── Statistical Rethinking ──
    topic("t-priors", "c-bayes", "Priors and the garden of forking data", "How a prior shapes what the data can say, and why a flat prior is still a choice.", 12, 0.9, ["bayes", "priors"]),
    topic("t-regression", "c-bayes", "Linear regression as a generative model", "Writing the model down before fitting it: likelihood, linear model, priors, posterior.", 28, 0.62, ["regression", "models"]),
    item("i-b1", "c-bayes", "Why does a flat prior over p imply a non-flat prior over log-odds?", "", "mastered", 0.95, "recall", ["priors"], "2026-09-14T10:12:00Z"),
    item("i-b2", "c-bayes", "Explain grid approximation in your own words", "", "lit", 0.78, "essay", ["posterior", "computation"], "2026-09-20T08:40:00Z"),
    item("i-b3", "c-bayes", "What does the posterior predictive distribution add to the posterior?", "", "lit", 0.7, "recall", ["posterior", "prediction"], "2026-10-02T19:03:00Z"),
    item("i-b4", "c-bayes", "Simulate from the prior before seeing data. What is this called?", "", "emerging", 0.4, "mcq", ["priors", "simulation"]),
    item("i-b5", "c-bayes", "Design an experiment to show when a weakly informative prior matters", "", "emerging", 0.35, "experiment", ["priors", "design"]),
    item("i-b6", "c-bayes", "Interpret the slope of a standardised predictor", "", "mastered", 0.88, "recall", ["regression"], "2026-10-11T12:30:00Z"),

    // ── Augur v3 ──
    topic("t-markets", "c-augur", "Market lifecycle", "Creation, trading, reporting, disputing, finalising: the stages a market passes through and what can go wrong at each.", 15, 0.55, ["markets", "lifecycle"]),
    topic("t-oracle", "c-augur", "The oracle and its incentives", "Why reporters tell the truth: REP staking, dispute bonds and the fork as a last resort.", 20, 0.3, ["oracle", "rep"]),
    item("i-a1", "c-augur", "What happens to a market with no designated report after the window closes?", "", "lit", 0.72, "mcq", ["lifecycle", "reporting"], "2026-10-15T09:00:00Z"),
    item("i-a2", "c-augur", "Describe how a dispute bond escalates round by round", "", "lit", 0.66, "essay", ["dispute", "rep"], "2026-10-18T14:22:00Z"),
    item("i-a3", "c-augur", "Why does a fork migrate REP rather than the market?", "", "emerging", 0.3, "recall", ["fork", "rep"]),
    item("i-a4", "c-augur", "Compute the minimum first dispute bond for a market with 10 REP at stake", "", "emerging", 0.45, "recall", ["dispute", "arithmetic"]),
    item("i-a5", "c-augur", "Trace a market from creation to finalisation in one paragraph", "", "mastered", 0.9, "essay", ["lifecycle"], "2026-10-25T17:48:00Z"),
    item("i-a6", "c-augur", "Which fee goes to the market creator, and when?", "", "lit", 0.74, "mcq", ["fees", "lifecycle"], "2026-10-27T11:15:00Z"),

    // ── Cell Biology ──
    topic("t-membrane", "c-cells", "Membrane transport", "Passive and active transport across the lipid bilayer: channels, carriers, pumps and the gradients they spend.", 18, 0.87, ["membrane", "transport"]),
    topic("t-signal", "c-cells", "Signal transduction", "Receptors, second messengers and kinase cascades: how a signal outside becomes a response inside.", 24, 0.5, ["signalling", "receptors"]),
    item("i-c1", "c-cells", "Contrast a channel and a carrier in terms of rate and saturation", "", "mastered", 0.92, "recall", ["transport", "kinetics"], "2026-08-30T07:55:00Z"),
    item("i-c2", "c-cells", "Why does the Na+/K+ pump matter for the resting potential?", "", "mastered", 0.86, "essay", ["pumps", "potential"], "2026-09-05T13:10:00Z"),
    item("i-c3", "c-cells", "Which second messenger does adenylyl cyclase produce?", "", "lit", 0.8, "mcq", ["signalling", "cAMP"], "2026-10-01T16:20:00Z"),
    item("i-c4", "c-cells", "Explain amplification in a kinase cascade", "", "lit", 0.68, "essay", ["signalling", "kinases"], "2026-10-09T10:05:00Z"),
    item("i-c5", "c-cells", "Design a test to tell primary from secondary active transport", "", "emerging", 0.42, "experiment", ["transport", "design"]),
    item("i-c6", "c-cells", "What does a G-protein's GTPase activity do to the signal?", "", "emerging", 0.38, "recall", ["signalling", "G-proteins"]),
  ];

  const links: GraphLink[] = [
    // ── member: topic ↔ item ──
    link("t-priors", "i-b1", "member", 0.9),
    link("t-priors", "i-b4", "member", 0.8),
    link("t-priors", "i-b5", "member", 0.75),
    link("t-regression", "i-b2", "member", 0.7),
    link("t-regression", "i-b3", "member", 0.85),
    link("t-regression", "i-b6", "member", 0.9),
    link("t-markets", "i-a1", "member", 0.9),
    link("t-markets", "i-a5", "member", 0.95),
    link("t-markets", "i-a6", "member", 0.8),
    link("t-oracle", "i-a2", "member", 0.9),
    link("t-oracle", "i-a3", "member", 0.85),
    link("t-oracle", "i-a4", "member", 0.7),
    link("t-membrane", "i-c1", "member", 0.9),
    link("t-membrane", "i-c2", "member", 0.85),
    link("t-membrane", "i-c5", "member", 0.75),
    link("t-signal", "i-c3", "member", 0.9),
    link("t-signal", "i-c4", "member", 0.85),
    link("t-signal", "i-c6", "member", 0.8),

    // ── prereq: topic → topic, item → item ──
    link("t-priors", "t-regression", "prereq", 0.9),
    link("t-markets", "t-oracle", "prereq", 0.85),
    link("t-membrane", "t-signal", "prereq", 0.7),
    link("i-b1", "i-b4", "prereq", 0.6),
    link("i-b2", "i-b3", "prereq", 0.7),
    link("i-b3", "i-b6", "prereq", 0.55),
    link("i-a1", "i-a2", "prereq", 0.65),
    link("i-a2", "i-a3", "prereq", 0.8),
    link("i-a2", "i-a4", "prereq", 0.6),
    link("i-a5", "i-a6", "prereq", 0.5),
    link("i-c1", "i-c2", "prereq", 0.75),
    link("i-c3", "i-c4", "prereq", 0.8),
    link("i-c2", "i-c5", "prereq", 0.5),
    link("i-c4", "i-c6", "prereq", 0.7),

    // ── concept: a shared missed concept, across courses too ──
    link("i-b4", "i-b5", "concept", 0.8),  // prior simulation
    link("i-a3", "i-a4", "concept", 0.7),  // REP arithmetic
    link("i-c5", "i-c6", "concept", 0.6),  // experimental design
    link("i-b5", "i-c5", "concept", 0.75), // "design an experiment" across courses
    link("i-b2", "i-a4", "concept", 0.5),  // computation by hand
    link("i-c4", "i-b3", "concept", 0.45), // amplification / prediction
    link("i-a2", "i-c4", "concept", 0.55), // cascades
    link("t-oracle", "t-signal", "concept", 0.4), // incentives as signals
  ];

  return { nodes, links, threshold: 70, pending: 7 };
}
