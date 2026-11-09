// The tour's steps and the static demo panels shown inside some of its cards.
// Demos are illustrations built from real markup and tokens: no images, no live data.

import type { JSX } from "react";
import type { AppState } from "@mastery/shared";
import { Icon } from "@mastery/ui/glass";

export type TourTab = "home" | "study" | "library" | "graph" | "progress";
export type TourSheet = "settings" | "library-add" | "build";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  anchor?: string;
  tab?: TourTab;
  demo?: "flow" | "marked" | "reading" | "spacing" | "calibration" | "graph";
}

export const ONBOARDING_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Mastery",
    body: "Mastery turns your own sources into a course, then tests you on it with spaced retrieval practice until you know it. Reading is not studying; retrieving is.",
  },
  {
    id: "key",
    title: "Your key",
    body: "Grading and course building call Claude with your own Anthropic API key, or with a managed key if this server offers one. The key is stored encrypted on the server and never reaches the browser.",
    anchor: "key",
    tab: "home",
  },
  {
    id: "drop",
    title: "Drop your sources",
    body: "Add PDFs, Markdown, plain text, DOCX, HTML, or a URL. Text is extracted on your machine, and nothing is copied anywhere else.",
    anchor: "drop",
    tab: "library",
  },
  {
    id: "build",
    title: "We build a course",
    body: "Topics come in the order they depend on each other, with multiple choice, free recall, essays with rubrics, and hands-on experiments where the material allows. Every item points back to the passage it came from, and the cost is shown before and after the build.",
    anchor: "build",
    tab: "library",
  },
  {
    id: "flow",
    title: "Quiz yourself first",
    body: "Each item has three steps: predict, answer from memory, then say how it went. Nothing is graded until the whole session is in, because feedback after each item turns the rest of the session into recognition.",
    anchor: "begin",
    tab: "home",
    demo: "flow",
  },
  {
    id: "marked",
    title: "Graded honestly",
    body: "Each answer is marked against its rubric, in your own words. Fluent prose that commits to nothing scores low; a hesitant answer built on the right mechanism scores higher.",
    demo: "marked",
  },
  {
    id: "reading",
    title: "Reading comes after a miss",
    body: "Only items below the threshold get a reading suggestion, pointed at the exact passage the item came from. A correct answer gets nothing to read.",
    demo: "reading",
  },
  {
    id: "spacing",
    title: "Spacing does the scheduling",
    body: "A pass moves an item one rung out, partial credit holds it, and a lapse sends it back to the start. Items come back when they are due, interleaved across your courses.",
    anchor: "due",
    tab: "home",
    demo: "spacing",
  },
  {
    id: "calibration",
    title: "Know what you know",
    body: "Every prediction is compared with the grade it got. Bias shows whether you run hot or cold; resolution shows whether your confidence tells hits from misses.",
    anchor: "tab-progress",
    tab: "home",
    demo: "calibration",
  },
  {
    id: "graph",
    title: "Your graph lights up",
    body: "An item becomes a node once its latest score reaches 75, and its topic appears with it. Links show prerequisites and shared concepts. Multiple choice alone never fully lights a node, because recognising an answer is not producing it.",
    anchor: "tab-graph",
    tab: "home",
    demo: "graph",
  },
  {
    id: "ready",
    title: "You are ready",
    body: "Add a key, drop a source, and build your first course. Then come back each day for whatever is due.",
  },
];

// ---------------------------------------------------------------- tailoring

export type FinalAction =
  | { kind: "sheet"; sheet: TourSheet; label: string }
  | { kind: "begin"; label: string };

/** The final step's primary call to action, chosen from what the learner still lacks. */
export function finalAction(state: AppState | null): FinalAction | null {
  if (!state) return null;
  if (state.key.mode === "none") return { kind: "sheet", sheet: "settings", label: "Add your key" };
  if (state.sources.length === 0) return { kind: "sheet", sheet: "library-add", label: "Drop a source" };
  if (state.courses.length === 0) return { kind: "sheet", sheet: "build", label: "Build a course" };
  return { kind: "begin", label: "Begin a session" };
}

/** Body copy adjusted to live state: the graph threshold and the final step's next move. */
export function tailoredBody(step: TourStep, state: AppState | null): string {
  if (!state) return step.body;
  if (step.id === "key" && !state.key.managedAvailable) {
    return "Grading and course building call Claude with your own Anthropic API key. The key is stored encrypted on the server and never reaches the browser.";
  }
  if (step.id === "graph") {
    const t = state.settings.graphThreshold;
    if (t && t !== 75) return step.body.replace("reaches 75", `reaches ${t}, your threshold`);
    return step.body.replace("reaches 75", "reaches 75, the default threshold");
  }
  if (step.id === "ready") {
    if (state.key.mode === "none") {
      return state.key.managedAvailable
        ? "Start with a key: paste your own or switch on the managed one. Then drop a source and build your first course."
        : "Start by adding your Anthropic API key. Then drop a source and build your first course.";
    }
    if (state.sources.length === 0) return "Your key is set. Drop a source next, then build your first course from it.";
    if (state.courses.length === 0) {
      return state.sources.length === 1
        ? "Your key is set and one source is in the library. Build a course from it next."
        : `Your key is set and ${state.sources.length} sources are in the library. Build a course from them next.`;
    }
    if (state.due > 0) {
      return state.due === 1
        ? "One item is due now. A session takes a few minutes and grades arrive at the end."
        : `${state.due} items are due now. A session takes a few minutes and grades arrive at the end.`;
    }
    return "Your courses are ready. Start a session to put new items in front of you.";
  }
  return step.body;
}

// ---------------------------------------------------------------- demos

export function Demo({ kind }: { kind: NonNullable<TourStep["demo"]> }): JSX.Element {
  switch (kind) {
    case "flow":
      return <DemoFlow />;
    case "marked":
      return <DemoMarked />;
    case "reading":
      return <DemoReading />;
    case "spacing":
      return <DemoSpacing />;
    case "calibration":
      return <DemoCalibration />;
    case "graph":
      return <DemoGraph />;
  }
}

function DemoFlow() {
  const detents = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  return (
    <div
      className="ob-demo ob-flow"
      role="img"
      aria-label="Predict at 70 percent, answer from memory, then reflect before any grade."
    >
      <div className="ob-flow-row" aria-hidden="true">
        <span className="ob-flow-n">1</span>
        <span className="ob-flow-l">Predict</span>
        <span className="ob-picker">
          {detents.map((d) => (
            <span key={d} className={`ob-det${d <= 70 ? " on" : ""}${d === 70 ? " at" : ""}`} />
          ))}
        </span>
        <span className="ob-flow-v">70</span>
      </div>
      <div className="ob-flow-row" aria-hidden="true">
        <span className="ob-flow-n">2</span>
        <span className="ob-flow-l">Answer</span>
        <span className="ob-field">From memory, no notes<span className="ob-caret" /></span>
      </div>
      <div className="ob-flow-row" aria-hidden="true">
        <span className="ob-flow-n">3</span>
        <span className="ob-flow-l">Reflect</span>
        <span className="ob-mseg">
          <span>Missed</span>
          <span className="on">Partly</span>
          <span>Solid</span>
        </span>
      </div>
      <p className="ob-demo-foot" aria-hidden="true">
        <Icon name="info" small />
        Grades arrive after the last item.
      </p>
    </div>
  );
}

function DemoMarked() {
  return (
    <div
      className="ob-demo ob-marked"
      role="img"
      aria-label="A graded answer scoring 64: two rubric points met, one absent, with one weak phrase and one wrong claim marked in the answer."
    >
      <div className="ob-marked-head" aria-hidden="true">
        <span className="ob-score mid">64</span>
        <span className="ob-q">Why does ice float on water?</span>
      </div>
      <ul className="ob-rubric" aria-hidden="true">
        <li><span className="ob-v met">Met</span>States the density difference</li>
        <li><span className="ob-v part">Partial</span>Names hydrogen bonding</li>
        <li><span className="ob-v abs">Absent</span>Explains why the lattice is open</li>
      </ul>
      <p className="ob-answer" aria-hidden="true">
        <mark className="ob-good">Ice is less dense than liquid water</mark> because{" "}
        <mark className="ob-weak">the molecules sort of lock together</mark> as it freezes.{" "}
        <mark className="ob-wrong">It also holds trapped air</mark>, which helps it rise.
      </p>
    </div>
  );
}

function DemoReading() {
  return (
    <div
      className="ob-demo ob-reading"
      role="img"
      aria-label="An item scored 58 gets a reading: chapter 3, pages 41 to 44. An item scored 91 gets nothing to read."
    >
      <div className="ob-read-row" aria-hidden="true">
        <span className="ob-score mid">58</span>
        <span className="ob-read-main">
          <span className="ob-read-t">Scored 58 · Read: Chapter 3, pages 41 to 44</span>
          <span className="ob-read-s">The passage this item came from</span>
        </span>
        <Icon name="book" small />
      </div>
      <div className="ob-read-row dim" aria-hidden="true">
        <span className="ob-score good">91</span>
        <span className="ob-read-main">
          <span className="ob-read-t">Scored 91 · Nothing to read</span>
          <span className="ob-read-s">Above the threshold</span>
        </span>
        <Icon name="check" small />
      </div>
    </div>
  );
}

function DemoSpacing() {
  const rungs = [1, 2, 4, 8, 16, 32, 64, 120];
  const at = 3; // the item sits on the 8-day rung
  return (
    <div
      className="ob-demo ob-spacing"
      role="img"
      aria-label="Intervals of 1, 2, 4, 8, 16, 32, 64 and 120 days. An item on 8 days moves to 16 on a pass, stays on 8 with partial credit, and returns to 1 on a lapse."
    >
      <ol className="ob-ladder" aria-hidden="true">
        {rungs.map((d, i) => (
          <li key={d} className={`ob-rung${i === at ? " at" : i === at + 1 ? " next" : i === 0 ? " start" : ""}`}>
            <span className="ob-rung-n">{d}</span>
          </li>
        ))}
      </ol>
      <p className="ob-ladder-unit" aria-hidden="true">days until the item comes back</p>
      <ul className="ob-legend" aria-hidden="true">
        <li><span className="ob-key pass" />Pass: 8 to 16</li>
        <li><span className="ob-key hold" />Partial: stays at 8</li>
        <li><span className="ob-key lapse" />Lapse: back to 1</li>
      </ul>
    </div>
  );
}

function DemoCalibration() {
  return (
    <div
      className="ob-demo ob-calib"
      role="img"
      aria-label="Bias plus 12, meaning overconfident. Resolution 0.41. Example: you predicted 80 on average and scored 68."
    >
      <div className="ob-stats" aria-hidden="true">
        <div className="ob-stat">
          <span className="ob-stat-n">+12</span>
          <span className="ob-stat-l">Bias</span>
          <span className="ob-stat-c">Predicted minus scored. Positive is overconfident.</span>
        </div>
        <div className="ob-stat">
          <span className="ob-stat-n">0.41</span>
          <span className="ob-stat-l">Resolution</span>
          <span className="ob-stat-c">Does your confidence separate hits from misses.</span>
        </div>
      </div>
      <p className="ob-demo-foot" aria-hidden="true">You predicted 80 on average and scored 68: bias +12.</p>
    </div>
  );
}

function DemoGraph() {
  // Positions in a 280 × 110 box. c = course colour token, lit = reached the threshold, half = multiple choice only.
  const nodes: { x: number; y: number; c: string; lit?: boolean; half?: boolean; glow?: boolean }[] = [
    { x: 34, y: 66, c: "var(--bloom-home)", lit: true },
    { x: 86, y: 28, c: "var(--bloom-home)", lit: true },
    { x: 132, y: 74, c: "var(--bloom-graph)", lit: true, glow: true },
    { x: 182, y: 30, c: "var(--bloom-study)", half: true },
    { x: 226, y: 78, c: "var(--bloom-study)" },
    { x: 252, y: 34, c: "var(--bloom-library)" },
    { x: 88, y: 96, c: "var(--bloom-graph)" },
  ];
  const links: [number, number][] = [[0, 1], [1, 2], [0, 2], [2, 3], [3, 4], [3, 5], [2, 6], [4, 5]];
  return (
    <div
      className="ob-demo ob-graph"
      role="img"
      aria-label="A small graph: three lit nodes in course colours, one glowing as it lights, one half lit by multiple choice only, and three dim nodes not yet mastered."
    >
      <svg viewBox="0 0 280 110" aria-hidden="true" focusable="false">
        {links.map(([a, b]) => {
          const p = nodes[a];
          const q = nodes[b];
          if (!p || !q) return null;
          return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="ob-link" />;
        })}
        {nodes.map((n, i) => (
          <g key={i} className={`ob-node${n.lit ? " lit" : n.half ? " half" : ""}${n.glow ? " glow" : ""}`} style={{ color: n.c }}>
            {n.glow && <circle cx={n.x} cy={n.y} r={14} className="ob-halo" />}
            <circle cx={n.x} cy={n.y} r={n.glow ? 7 : 5.5} className="ob-dot" />
          </g>
        ))}
      </svg>
      <ul className="ob-legend" aria-hidden="true">
        <li><span className="ob-key lit" />Lit</li>
        <li><span className="ob-key half" />Multiple choice only</li>
        <li><span className="ob-key dim" />Not yet</li>
      </ul>
    </div>
  );
}
