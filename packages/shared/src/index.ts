/**
 * Types shared by the server and the web app. This file is the API contract: if the
 * server changes a shape, it changes here first, and the web app follows the compiler.
 *
 * Vocabulary
 *   Source   one document you dropped in (PDF, Markdown, text, HTML, DOCX). Stored as extracted text.
 *   Course   what Mastery built from one or more sources: topics in dependency order, each with items.
 *   Item     one retrieval prompt. Four types, graded differently.
 *   Session  one sitting: predict → answer → reflect for each item, then everything graded at once.
 *   Node     a topic or item that has earned its place on the knowledge graph.
 */

// ---------------------------------------------------------------- sources

export type SourceKind = "pdf" | "markdown" | "text" | "html" | "docx" | "epub" | "url";

export interface Source {
  id: string;
  title: string;
  kind: SourceKind;
  /** Original filename or URL. */
  origin: string;
  bytes: number;
  chars: number;
  pages?: number;
  added: string;
  /** Number of text chunks the extractor produced. The text itself is fetched separately. */
  chunks: number;
  /** Set when text extraction produced nothing usable (scanned PDF, empty file). */
  warning?: string;
}

export interface SourceChunk {
  index: number;
  /** Page range or heading path, whatever the extractor could recover. */
  locator: string;
  text: string;
}

// ---------------------------------------------------------------- courses

export type ItemType = "mcq" | "recall" | "essay" | "experiment";

export interface Item {
  id: string;
  courseId: string;
  topicId: string;
  type: ItemType;
  /** 1 (foundational) to 3 (demanding). */
  difficulty: 1 | 2 | 3;
  prompt: string;
  /** mcq only */
  choices?: string[];
  /** mcq only, 0-based. HIDDEN from the client until graded. */
  answerIndex?: number;
  /** HIDDEN until graded. */
  answerKey?: string;
  /** essay / experiment. HIDDEN until graded. */
  rubric?: string[];
  /** Items that should be attempted first. */
  prereq: string[];
  /** Where in the sources this item is grounded. HIDDEN until graded. */
  grounding: { sourceId: string; chunk: number; locator: string }[];
  /** Optional one-liner connecting the item to things the learner already knows. */
  bridge?: string;
}

/** An item as the browser is allowed to see it before grading. */
export type PublicItem = Omit<Item, "answerIndex" | "answerKey" | "rubric" | "grounding"> & {
  topic: string;
  course: string;
};

export interface Topic {
  id: string;
  courseId: string;
  title: string;
  summary: string;
  /** Topic ids that come first. */
  prereq: string[];
  /** 1 (broad) … 100 (specific), used by the graph for node size. */
  abstraction: number;
  grounding: { sourceId: string; chunk: number; locator: string }[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  sourceIds: string[];
  topics: Topic[];
  items: Item[];
  created: string;
  /** Model and token usage of the build, so the cost is visible rather than guessed. */
  build: { model: string; usage: Usage; seconds: number };
}

export type CourseSummary = Omit<Course, "topics" | "items"> & {
  topicCount: number;
  itemCount: number;
  stats: TrackStats;
};

// ---------------------------------------------------------------- jobs (course generation)

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobEvent {
  at: string;
  /** Short, present tense, for the progress UI: "Reading 'Chapter 3' (2 of 9)". */
  message: string;
  /** 0–1 */
  progress: number;
}

export interface Job {
  id: string;
  kind: "build-course";
  status: JobStatus;
  created: string;
  finished?: string;
  events: JobEvent[];
  error?: string;
  /** Set when done. */
  courseId?: string;
  usage: Usage;
}

export interface BuildCourseRequest {
  sourceIds: string[];
  /** Optional; the model names the course otherwise. */
  title?: string;
  /** Roughly how many items per topic. */
  depth: "light" | "standard" | "deep";
  /** What the learner already knows, so bridges can be written. Optional. */
  background?: string;
}

// ---------------------------------------------------------------- scheduling

export interface ItemState {
  box: number;
  due: string | null;
  seen: number;
  lapses: number;
  lastScore: number | null;
  scores: number[];
  lastSeen: string | null;
  retired: boolean;
  /** Latest non-mcq score, for the graph's recognition caveat. */
  lastProducedScore: number | null;
}

export interface TrackStats {
  total: number;
  seen: number;
  due: number;
  retired: number;
  meanScore: number | null;
  /** Items currently lit on the graph. */
  lit: number;
}

// ---------------------------------------------------------------- sessions and grading

export interface SessionStart {
  id: string;
  started: string;
  items: PublicItem[];
  message?: string;
}

export interface Response {
  id: string;
  response: string;
  /** Predicted probability of full correctness, 0–100, before answering. */
  jolPre: number | null;
  /** Self-assessed performance, 0–100, after answering and before the grade. */
  jolPost: number | null;
}

export interface SubmitRequest {
  id: string;
  started: string;
  responses: Response[];
}

export interface RubricScore { criterion: string; verdict: "met" | "partial" | "absent"; note: string }
export interface Quote { text: string; kind: "good" | "weak" | "wrong"; why: string }

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  calls: number;
  perModel: Record<string, { calls: number; input: number; output: number; cacheWrite: number; cacheRead: number }>;
  cacheHitRatio: number;
  /** Indicative USD from published rates. */
  estimatedCost: number;
}

export interface Grade {
  score: number | null;
  rubricScores: RubricScore[];
  feedback: string;
  probe: string | null;
  missedConcepts: string[];
  quotes: Quote[];
  gradedBy: string;
  error?: string;
}

export interface GradedItem extends Grade {
  id: string;
  courseId: string;
  course: string;
  topicId: string;
  topic: string;
  type: ItemType;
  difficulty: number;
  prompt: string;
  choices?: string[];
  answerIndex?: number;
  answerKey?: string;
  rubric: string[];
  bridge?: string;
  response: string;
  jolPre: number | null;
  jolPost: number | null;
  /** Reading that attaches only to a miss (score below the graph threshold). */
  reading: { sourceId: string; title: string; locator: string; chunk: number }[];
  /** What this answer did to the graph. */
  graph: { lit: boolean; newlyLit: boolean };
}

export interface Calibration {
  meanScore: number | null;
  /** Mean jolPre minus mean score. Positive is overconfidence. */
  bias: number | null;
  /** Correlation between jolPre and score; null under 4 items. */
  resolution: number | null;
  foresightItems: string[];
  report?: string;
  recommendations?: string[];
  error?: string;
}

export interface SessionRecord {
  id: string;
  started: string | null;
  finished: string;
  courseIds: string[];
  responses: GradedItem[];
  calibration: Calibration;
  usage: Usage;
}

export interface CalibrationPoint {
  finished: string;
  items: number;
  bias: number;
  resolution: number | null;
  meanScore: number | null;
}

// ---------------------------------------------------------------- knowledge graph

/**
 * The graph the web app renders. Only nodes that have earned their place are included
 * (see docs/graph-threshold.md). `domain` is the course, which sets the colour.
 */
export type NodeKind = "topic" | "item";
export type NodeState = "emerging" | "lit" | "mastered";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Course id; the legend groups by it. */
  domain: string;
  domainTitle: string;
  /** Topic title, or the item's prompt opening. */
  label: string;
  content: string;
  /** 1 (broad) … 100 (specific). */
  abstraction: number;
  state: NodeState;
  /** 0–1 mastery: latest score / 100 for items, lit fraction for topics. */
  mastery: number;
  tags: string[];
  /** Items: when it was first lit. */
  litAt?: string;
  itemType?: ItemType;
}

export type LinkKind = "member" | "prereq" | "concept";

export interface GraphLink {
  source: string;
  target: string;
  kind: LinkKind;
  /** 0–1 strength, drives beam width and glow. */
  similarity: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  threshold: number;
  /** Items answered but not yet lit, for the "n more to light" hint. */
  pending: number;
}

// ---------------------------------------------------------------- settings and keys

export type KeyMode = "none" | "byok" | "managed";

export interface KeyStatus {
  mode: KeyMode;
  /** Last four characters of a BYO key, for recognition only. */
  last4?: string;
  /** Whether the key was accepted by the API on the last check. */
  valid?: boolean;
  checkedAt?: string;
  /** The server offers a managed key when MASTERY_MANAGED_KEY is set. */
  managedAvailable: boolean;
  error?: string;
}

export interface Settings {
  graphThreshold: number;
  sessionSize: number;
  /** Learner's own background, used for bridges in course generation and grading. */
  background: string;
  onboardingDone: boolean;
  routing: Record<string, string>;
}

export interface AppState {
  courses: CourseSummary[];
  sources: Source[];
  settings: Settings;
  key: KeyStatus;
  sessionsDone: number;
  due: number;
  fresh: number;
  calibration: CalibrationPoint[];
  graph: { nodes: number; links: number; pending: number };
}

// ---------------------------------------------------------------- API routes (documentation)

/**
 * GET  /api/state                         → AppState
 * GET  /api/settings | PUT /api/settings  → Settings
 * GET  /api/keys                          → KeyStatus
 * PUT  /api/keys        { mode: "byok", key } | { mode: "managed" } | { mode: "none" } → KeyStatus
 * POST /api/keys/validate                 → KeyStatus
 * GET  /api/library                       → Source[]
 * POST /api/library     multipart/form-data, field "files" (many)  → Source[]
 * POST /api/library/url { url }           → Source
 * GET  /api/library/:id/text?chunk=n      → SourceChunk | { chunks: SourceChunk[] }
 * DELETE /api/library/:id
 * GET  /api/courses                       → CourseSummary[]
 * GET  /api/courses/:id                   → Course (items public-safe)
 * DELETE /api/courses/:id
 * POST /api/courses/build  BuildCourseRequest → Job
 * GET  /api/jobs/:id                      → Job
 * GET  /api/jobs/:id/events               → text/event-stream of JobEvent, then {done:true}
 * POST /api/session/new  { courseIds?, size? } → SessionStart
 * POST /api/session/submit SubmitRequest  → SessionRecord
 * GET  /api/history                       → SessionRecord[]
 * GET  /api/graph                         → GraphData
 * GET  /api/prompts | PUT /api/prompts/:name  → the editable grading and generation prompts
 */
export const API_VERSION = 1;
