/**
 * Split extracted text into chunks the course builder can cite.
 *
 * The text may carry unit markers ("\n\n[[page N]]\n\n", "[[slide N]]", "[[section N]]",
 * written by the extractors). They are consumed here: they set the unit of every block
 * that follows and are never copied into chunk text. Headings are Markdown ("## 3.2 Sampling").
 *
 * Packing: blocks (paragraphs) are appended to the current chunk until adding one would
 * exceed `target` characters. A heading closes the current chunk early once it is at
 * least half full, so chunk boundaries prefer section boundaries. A single block longer
 * than `target` is split on line, then sentence, boundaries.
 *
 * Locator priority: unit range (p. 12 / slides 3–5 / section 2) › heading path › paragraph range.
 */
import type { SourceChunk } from "@mastery/shared";

export const DEFAULT_TARGET = 6000;
export const DEFAULT_OVERLAP = 300;

/** What a marker counts: PDF pages, deck slides, or EPUB spine sections. */
export type Unit = "page" | "slide" | "section";

const MARKER_RE = /^\[\[(page|slide|section) (\d+)\]\]$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** The marker an extractor writes before each unit's text. */
export function unitMarker(unit: Unit, n: number): string {
  return `\n\n[[${unit} ${n}]]\n\n`;
}

/** The marker the PDF extractor writes before each page's text. Alias of unitMarker("page", n). */
export function pageMarker(page: number): string {
  return unitMarker("page", page);
}

/** Locator vocabulary: singular for one unit, plural with an en dash for a range. */
const LOCATOR: Record<Unit, { one: string; many: string }> = {
  page: { one: "p.", many: "pp." },
  slide: { one: "slide", many: "slides" },
  section: { one: "section", many: "sections" },
};

interface Block {
  text: string;
  /** 1-based paragraph number, counting headings. */
  para: number;
  unit: Unit | null;
  n: number | null;
  /** Heading path in effect for this block (includes the block itself if it is a heading). */
  path: string[];
  isHeading: boolean;
}

function splitLong(text: string, target: number): string[] {
  if (text.length <= target) return [text];
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  // Lines first, then sentences inside an over-long line, then hard cuts.
  const units: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= target) { units.push(line + "\n"); continue; }
    for (const sentence of line.split(/(?<=[.!?。])\s+/)) {
      if (sentence.length <= target) { units.push(sentence + " "); continue; }
      for (let i = 0; i < sentence.length; i += target) units.push(sentence.slice(i, i + target) + " ");
    }
  }
  for (const u of units) {
    if (cur.length > 0 && cur.length + u.length > target) push();
    cur += u;
  }
  push();
  return out;
}

function toBlocks(text: string, target: number): { blocks: Block[]; hasUnits: boolean } {
  const blocks: Block[] = [];
  let hasUnits = false;
  let unit: Unit | null = null;
  let n: number | null = null;
  let para = 0;
  const headings: { level: number; title: string }[] = [];

  for (const raw of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // A marker on its own line, possibly glued to the following paragraph by a single newline.
    const lines = trimmed.split("\n");
    let rest = trimmed;
    while (lines.length) {
      const pm = MARKER_RE.exec(lines[0]!.trim());
      if (!pm) break;
      unit = pm[1] as Unit;
      n = Number(pm[2]);
      hasUnits = true;
      lines.shift();
      rest = lines.join("\n").trim();
    }
    if (!rest) continue;
    const hm = rest.includes("\n") ? null : HEADING_RE.exec(rest);
    if (hm) {
      const level = hm[1]!.length;
      const title = hm[2]!.trim();
      while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
      headings.push({ level, title });
      blocks.push({ text: rest, para: ++para, unit, n, path: headings.map((h) => h.title), isHeading: true });
      continue;
    }
    const path = headings.map((h) => h.title);
    for (const piece of splitLong(rest, target)) {
      blocks.push({ text: piece, para: ++para, unit, n, path, isHeading: false });
    }
  }
  return { blocks, hasUnits };
}

const EN_DASH = "–";

function locatorFor(blocks: Block[], hasUnits: boolean): string {
  const unit = blocks.find((b) => b.unit)?.unit;
  if (hasUnits && unit) {
    const ns = blocks.filter((b) => b.unit === unit && b.n !== null).map((b) => b.n as number);
    const lo = Math.min(...ns);
    const hi = Math.max(...ns);
    const words = LOCATOR[unit];
    return lo === hi ? `${words.one} ${lo}` : `${words.many} ${lo}${EN_DASH}${hi}`;
  }
  const first = blocks[0]!;
  if (first.path.length) return first.path.join(" › ");
  const lo = first.para;
  const hi = blocks[blocks.length - 1]!.para;
  return lo === hi ? `¶ ${lo}` : `¶ ${lo}${EN_DASH}${hi}`;
}

/** Last `n` characters of `s`, cut forward to a word boundary so it does not start mid-word. */
function tail(s: string, n: number): string {
  if (n <= 0 || !s) return "";
  if (s.length <= n) return s;
  let cut = s.slice(s.length - n);
  const ws = cut.search(/\s/);
  if (ws > 0 && ws < cut.length - 1) cut = cut.slice(ws + 1);
  return cut.trimStart();
}

export function chunkText(text: string, opts: { target?: number; overlap?: number } = {}): SourceChunk[] {
  const target = Math.max(200, opts.target ?? DEFAULT_TARGET);
  const overlap = Math.max(0, Math.min(opts.overlap ?? DEFAULT_OVERLAP, Math.floor(target / 2)));
  if (!text || !text.trim()) return [];

  const { blocks, hasUnits } = toBlocks(text, target);
  if (!blocks.length) return [];

  const groups: Block[][] = [];
  let cur: Block[] = [];
  let curLen = 0;
  const flush = () => { if (cur.length) groups.push(cur); cur = []; curLen = 0; };

  for (const b of blocks) {
    const add = b.text.length + (cur.length ? 2 : 0);
    if (cur.length && b.isHeading && curLen >= target / 2) flush();
    else if (cur.length && curLen + add > target) flush();
    cur.push(b);
    curLen += b.text.length + (cur.length > 1 ? 2 : 0);
  }
  flush();

  const chunks: SourceChunk[] = [];
  let prevOwn = "";
  groups.forEach((g, index) => {
    const own = g.map((b) => b.text).join("\n\n");
    const lead = index > 0 ? tail(prevOwn, overlap) : "";
    chunks.push({ index, locator: locatorFor(g, hasUnits), text: lead ? `${lead}\n\n${own}` : own });
    prevOwn = own;
  });
  return chunks;
}
