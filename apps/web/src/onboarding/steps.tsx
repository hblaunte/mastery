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
    body: "Mastery turns the documents you already have into a course, then tests you on it until you can produce the material from memory rather than recognise it on the page. Rereading feels like learning and largely is not; being asked, and having to answer, is what moves a thing into memory (the 'testing effect', and the reason the library here sits beside the quiz rather than in front of it).",
  },
  {
    id: "key",
    title: "Your key, your bill",
    body: "You pay only for what you use. Grading and course building run on Claude with your own Anthropic key, so the only bill is Anthropic's, and every session shows what it cost (a few cents for recall, more for essays). If you would rather not hold a key, this server offers a managed one. Either way the key is stored encrypted on this machine and used only by the server. The browser never sees it.",
    anchor: "key",
    tab: "home",
  },
  {
    id: "drop",
    title: "Drop in what you are learning from",
    body: "Learn from the material you already have rather than from a syllabus someone else wrote. A PDF, a Markdown or text file, a DOCX, an HTML page, or a URL all work. The text is extracted here, on your machine, and nothing is sent anywhere until you build a course or grade a session (and then only the passages involved).",
    anchor: "drop",
    tab: "library",
  },
  {
    id: "build",
    title: "A course from your sources",
    body: "One press turns a source into something you can be tested on. You get the topics in the order they depend on each other, each with its own items (multiple choice, free recall, essays with rubrics, and hands-on experiments where the material is technical). Every item cites the passage it came from, so a wrong answer always has a page to go back to. The cost is estimated before the build and shown exactly after it.",
    anchor: "build",
    tab: "library",
  },
  {
    id: "flow",
    title: "Predict, answer, reflect",
    body: "You find out what you can actually produce, as opposed to what merely looks familiar. A session asks three things of you per item. First, how likely you are to get it fully right (0 to 100). Then the answer itself, from memory. Then how it went. Grades arrive only after the last item, because a mark seen mid-session turns the remaining items from recall into recognition, which is precisely the thing a session is meant to rule out.",
    anchor: "begin",
    tab: "home",
    demo: "flow",
  },
  {
    id: "marked",
    title: "Marked on your own sentences",
    body: "You see which of your own sentences lost the marks, rather than being told the answer was 'incomplete'. Each answer is scored against a rubric and the passage it came from, and the phrases that earned or lost credit are highlighted in your text with a one-line note on each. Fluent prose that commits to nothing scores low. A short answer with the right mechanism scores higher.",
    demo: "marked",
  },
  {
    id: "reading",
    title: "Reading only after a miss",
    body: "Reading comes after a miss, never before the attempt. Score below 75 and the item points you to the exact passage it was written from (the section, the pages). Score 75 or above and there is nothing to read, because you have just shown you did not need it.",
    demo: "reading",
  },
  {
    id: "spacing",
    title: "The ladder decides what comes back",
    body: "You never have to decide what to revise. Each item sits on a ladder of intervals (1, 2, 4, 8, 16, 32, 64 and 120 days). A pass moves it one rung out, partial credit (45 to 69) holds it, and a lapse (under 45) sends it back to one day. Due items from different courses are mixed into one session rather than blocked by course – the mixing feels harder, and that harder retrieval is what makes the interval stick.",
    anchor: "due",
    tab: "home",
    demo: "spacing",
  },
  {
    id: "calibration",
    title: "Know what you know",
    body: "You learn whether you can trust your own sense of knowing. The number that matters is the gap between what you predicted and what you got. Bias is predicted minus scored (positive means you expected more than you produced), and resolution is whether your confidence rises on the items you then get right. A learner who is overconfident on recall but calibrated on essays can perhaps talk about the material and cannot yet retrieve it, and the report says so in those terms.",
    anchor: "tab-progress",
    tab: "home",
    demo: "calibration",
  },
  {
    id: "graph",
    title: "The map of what you have mastered",
    body: "What you have mastered becomes a map, and it gains a node each time you produce an item correctly. An item becomes a node once its latest score reaches 75, its topic appears with it, and the links show which items depend on which and which concepts you keep missing together. Multiple choice alone never lights a node, since recognising the right option among four is not the same as producing it, and the map is only worth looking at if it records production. A node goes dark again if the item lapses, so the map shows what you know now rather than what you once knew.",
    anchor: "tab-graph",
    tab: "home",
    demo: "graph",
  },
  {
    id: "ready",
    title: "Where to start",
    body: "Add a key, drop a source, build a course from it, then come back each day for whatever is due. A session of eight items may take ten to fifteen minutes.",
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

/** Body copy adjusted to live state: the managed key, the graph threshold and the final step's next move. */
export function tailoredBody(step: TourStep, state: AppState | null): string {
  if (!state) return step.body;
  if (step.id === "key" && !state.key.managedAvailable) {
    return "You pay only for what you use. Grading and course building run on Claude with your own Anthropic key, so the only bill is Anthropic's, and every session shows what it cost (a few cents for recall, more for essays). The key is stored encrypted on this machine and used only by the server. The browser never sees it.";
  }
  if (step.id === "graph" || step.id === "reading") {
    const t = state.settings.graphThreshold;
    return t && t !== 75 ? step.body.replaceAll("75", String(t)) : step.body;
  }
  if (step.id === "ready") {
    if (state.key.mode === "none") {
      return state.key.managedAvailable
        ? "Add a key first (paste your own, or switch on the managed one). Then drop a source and build a course from it. A session of eight items may take ten to fifteen minutes."
        : "Add your Anthropic key first, since nothing can be built or graded without it. Then drop a source and build from it. A session of eight items may take ten to fifteen minutes.";
    }
    if (state.sources.length === 0) return "Your key is in. Drop a source next (a PDF or a Markdown file is the quickest start), then build a course from it.";
    if (state.courses.length === 0) {
      return state.sources.length === 1
        ? "Your key is in and one source is in the library. Build a course from it next. A light build takes a few minutes and may cost under a dollar."
        : `Your key is in and ${state.sources.length} sources are in the library. Build a course from them next. A light build takes a few minutes and may cost under a dollar.`;
    }
    if (state.due > 0) {
      return state.due === 1
        ? "One item is due now. A session takes a few minutes, and the grades arrive at the end."
        : `${state.due} items are due now. A session takes a few minutes, and the grades arrive at the end.`;
    }
    return "Nothing is due yet, which is the ladder working. Begin a session anyway to put new items in front of you.";
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
      aria-label="Predict 70 percent, answer from memory, then reflect at 40 percent before any grade. The answer felt available and did not come."
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
        <span className="ob-picker">
          {detents.map((d) => (
            <span key={d} className={`ob-det${d <= 40 ? " on" : ""}${d === 40 ? " at" : ""}`} />
          ))}
        </span>
        <span className="ob-flow-v">40</span>
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
      aria-label="A graded answer scoring 64, with one rubric point met, one partial and one absent, and one good phrase, one weak phrase and one wrong claim marked in the answer."
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
          <span className="ob-read-s">The passage this item was written from</span>
        </span>
        <Icon name="book" small />
      </div>
      <div className="ob-read-row dim" aria-hidden="true">
        <span className="ob-score good">91</span>
        <span className="ob-read-main">
          <span className="ob-read-t">Scored 91 · Nothing to read</span>
          <span className="ob-read-s">At or above 75; you did not need it</span>
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
      aria-label="Bias plus 12 (you predicted 80 on average and scored 68, so you expected more than you produced). Resolution 0.41 (your confidence rose somewhat on the items you then got right)."
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
          <span className="ob-stat-c">Whether your confidence rises on the items you get right.</span>
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
        <li><span className="ob-key dim" />Below 75</li>
      </ul>
    </div>
  );
}
