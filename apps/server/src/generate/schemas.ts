/**
 * JSON schemas for the structured-output calls, and the TypeScript shapes they produce.
 * Structured outputs accept basic types, enum, anyOf and additionalProperties:false, but no
 * numeric or length constraints, so lengths (4 choices, 3-5 criteria, 1-3 difficulty) are
 * stated in descriptions and enforced in validate().
 */

type Schema = Record<string, unknown>;

const str = (description?: string): Schema => (description ? { type: "string", description } : { type: "string" });
const int = (description?: string): Schema => (description ? { type: "integer", description } : { type: "integer" });
const arr = (items: Schema, description?: string): Schema => (description ? { type: "array", items, description } : { type: "array", items });
const nullable = (s: Schema, description: string): Schema => ({ anyOf: [s, { type: "null" }], description });
const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...(description ? { description } : {}),
});

const groundingRef = obj({
  sourceId: str("The sourceId exactly as given in the input."),
  chunk: int("The chunk index exactly as given in the input."),
}, "One chunk of one source.");

// ---------------------------------------------------------------- digest

export const DIGEST_SCHEMA: Schema = obj({
  summaries: arr(obj({
    index: int("Position of the chunk in this batch, starting at 0."),
    summary: str("One sentence, at most 30 words, stating what the chunk covers."),
  }), "One entry per chunk in the batch, in order."),
});

export interface DigestOut { summaries: { index: number; summary: string }[] }

// ---------------------------------------------------------------- outline

export const OUTLINE_SCHEMA: Schema = obj({
  title: str("Course title, at most 8 words."),
  description: str("Two or three sentences on what the course covers and what the learner will be able to do."),
  topics: arr(obj({
    title: str("Short noun phrase, unique within the course."),
    summary: str("Two or three sentences: the mechanism or idea, and the conditions under which it holds."),
    prereq: arr(str(), "Titles of topics in this outline that must come first. Empty if none."),
    abstraction: int("1 (broad, framing) to 100 (narrow, specific technique)."),
    grounding: arr(groundingRef, "The chunks the topic is drawn from, most relevant first."),
  }), "Topics in the order they should be learned."),
});

export interface OutlineOut {
  title: string;
  description: string;
  topics: {
    title: string;
    summary: string;
    prereq: string[];
    abstraction: number;
    grounding: { sourceId: string; chunk: number }[];
  }[];
}

// ---------------------------------------------------------------- items

export const ITEMS_SCHEMA: Schema = obj({
  items: arr(obj({
    type: { type: "string", enum: ["mcq", "recall", "essay", "experiment"] },
    difficulty: int("1 foundational, 2 intermediate, 3 demanding."),
    prompt: str("The question or task as the learner sees it."),
    choices: nullable(arr(str()), "mcq only: exactly 4 choices. null for other types."),
    answerIndex: nullable(int(), "mcq only: 0-based index of the correct choice. null for other types."),
    answerKey: str("What a full-credit answer must contain, written for a strict grader who has not read the source."),
    rubric: nullable(arr(str()), "essay and experiment only: 3 to 5 criteria, each a single checkable claim. null for other types."),
    prereq: arr(int(), "1-based positions, within this list, of items that should be attempted first. Empty if none."),
    grounding: arr(groundingRef, "The chunk(s) where the answer is found. At least one."),
    bridge: nullable(str(), "One sentence connecting the item to what the learner already knows, only when a background was given and the connection is honest. Otherwise null."),
  }), "The items for this topic, in the order they should be attempted."),
});

export interface ItemOut {
  type: "mcq" | "recall" | "essay" | "experiment";
  difficulty: number;
  prompt: string;
  choices: string[] | null;
  answerIndex: number | null;
  answerKey: string;
  rubric: string[] | null;
  prereq: number[];
  grounding: { sourceId: string; chunk: number }[];
  bridge: string | null;
}

export interface ItemsOut { items: ItemOut[] }
