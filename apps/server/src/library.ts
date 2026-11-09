/**
 * The library, laid out the way Karpathy's LLM-wiki pattern lays out knowledge: immutable raw
 * files, one human-readable Markdown page per source with frontmatter, a map of content and an
 * append-only log. Everything a person could want to open, diff or edit is plain text.
 *
 *   data/library/raw/<id>.<ext>       the original bytes, never edited
 *   data/library/sources/<id>.md      frontmatter + extracted Markdown; editable in the reader
 *   data/library/index.md             every source, one line each, grouped by kind
 *   data/library/log.md               append-only: ingests, edits, OCR runs, builds
 *
 * Passages (SourceChunk[]) are derived from the Markdown on read and cached by content hash, so
 * an edit to the page is what the course builder and the grader see next.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtractionMethod, Source, SourceChunk, SourceKind } from "@mastery/shared";
import { DATA_DIR } from "./config.js";
import { nowIso } from "./ids.js";
import { chunkText, estimateTokens } from "./ingest/index.js";

const LIB = path.join(DATA_DIR, "library");
const RAW = path.join(LIB, "raw");
const SRC = path.join(LIB, "sources");
const INDEX = path.join(LIB, "index.md");
const LOG = path.join(LIB, "log.md");

export function ensureLibrary(): void {
  mkdirSync(RAW, { recursive: true });
  mkdirSync(SRC, { recursive: true });
  if (!existsSync(LOG)) writeFileSync(LOG, "# Library log\n\nAppend-only. One line per ingest, edit, transcription or build.\n");
  if (!existsSync(INDEX)) rebuildIndex();
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safe(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`invalid id: ${id}`);
  return id;
}

// ---------------------------------------------------------------- frontmatter

type Meta = Omit<Source, "chars" | "chunks" | "tokens">;

function serialize(meta: Meta, markdown: string): string {
  const lines = ["---"];
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  };
  put("id", meta.id); put("title", meta.title); put("kind", meta.kind); put("origin", meta.origin);
  put("bytes", meta.bytes); put("pages", meta.pages); put("added", meta.added); put("hash", meta.hash);
  put("method", meta.method); put("needsOcr", meta.needsOcr); put("warning", meta.warning); put("edited", meta.edited);
  lines.push("---", "", markdown.replace(/^\n+/, ""));
  return lines.join("\n");
}

function parse(file: string): { meta: Meta; markdown: string } | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return null;
  const meta: Record<string, unknown> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    try { meta[line.slice(0, i).trim()] = JSON.parse(line.slice(i + 1).trim()); } catch { meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return { meta: meta as unknown as Meta, markdown: text.slice(m[0].length).replace(/^\n/, "") };
}

// ---------------------------------------------------------------- chunk cache

const chunkCache = new Map<string, { hash: string; chunks: SourceChunk[] }>();

function chunksFor(id: string, markdown: string): SourceChunk[] {
  const hash = createHash("sha1").update(markdown).digest("hex");
  const hit = chunkCache.get(id);
  if (hit && hit.hash === hash) return hit.chunks;
  const chunks = markdown.trim() ? chunkText(markdown) : [];
  chunkCache.set(id, { hash, chunks });
  return chunks;
}

function toSource(meta: Meta, markdown: string): Source {
  return { ...meta, chars: markdown.length, tokens: estimateTokens(markdown), chunks: chunksFor(meta.id, markdown).length };
}

// ---------------------------------------------------------------- reads

export function listSources(): Source[] {
  ensureLibrary();
  return readdirSync(SRC)
    .filter((n) => n.endsWith(".md"))
    .map((n) => parse(path.join(SRC, n)))
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .map(({ meta, markdown }) => toSource(meta, markdown))
    .sort((a, b) => b.added.localeCompare(a.added));
}

export function getSource(id: string): Source | null {
  const p = parse(path.join(SRC, `${safe(id)}.md`));
  return p ? toSource(p.meta, p.markdown) : null;
}

export function getMarkdown(id: string): string | null {
  return parse(path.join(SRC, `${safe(id)}.md`))?.markdown ?? null;
}

export function getChunks(id: string): SourceChunk[] {
  const p = parse(path.join(SRC, `${safe(id)}.md`));
  return p ? chunksFor(id, p.markdown) : [];
}

export function getRaw(id: string): { bytes: Uint8Array; ext: string } | null {
  const match = existsSync(RAW) ? readdirSync(RAW).find((n) => n.startsWith(`${safe(id)}.`)) : undefined;
  if (!match) return null;
  return { bytes: new Uint8Array(readFileSync(path.join(RAW, match))), ext: match.slice(id.length + 1) };
}

/** A source whose raw bytes hash the same: the same file dropped twice. */
export function findByHash(hash: string): Source | null {
  return listSources().find((s) => s.hash === hash) ?? null;
}

// ---------------------------------------------------------------- writes

export interface NewSource {
  id: string; title: string; kind: SourceKind; origin: string; bytes: number; pages?: number;
  hash: string; method: ExtractionMethod; needsOcr?: number[]; warning?: string;
}

const EXT: Record<SourceKind, string> = { pdf: "pdf", markdown: "md", text: "txt", html: "html", docx: "docx", pptx: "pptx", xlsx: "xlsx", epub: "epub", url: "html" };

export function addSource(meta: NewSource, markdown: string, raw?: Uint8Array): Source {
  ensureLibrary();
  const full: Meta = { ...meta, added: nowIso() };
  if (raw) atomicWriteBytes(path.join(RAW, `${safe(meta.id)}.${EXT[meta.kind]}`), raw);
  atomicWrite(path.join(SRC, `${safe(meta.id)}.md`), serialize(full, markdown));
  const source = toSource(full, markdown);
  log(`ingest | ${source.title} | ${source.kind} | ${source.chunks} passages | ${source.method}${source.needsOcr?.length ? ` | ${source.needsOcr.length} pages need OCR` : ""}`);
  rebuildIndex();
  return source;
}

/** Replace the Markdown body (an edit in the reader, or merged OCR). Frontmatter is kept and updated. */
export function updateMarkdown(id: string, markdown: string, patch: Partial<Meta> = {}, why = "edit"): Source | null {
  const file = path.join(SRC, `${safe(id)}.md`);
  const p = parse(file);
  if (!p) return null;
  const meta: Meta = { ...p.meta, ...patch, edited: why === "edit" ? nowIso() : p.meta.edited };
  atomicWrite(file, serialize(meta, markdown));
  const source = toSource(meta, markdown);
  log(`${why} | ${source.title} | ${source.chunks} passages`);
  rebuildIndex();
  return source;
}

export function deleteSource(id: string): boolean {
  const file = path.join(SRC, `${safe(id)}.md`);
  const p = parse(file);
  if (!p) return false;
  rmSync(file);
  const raw = existsSync(RAW) ? readdirSync(RAW).find((n) => n.startsWith(`${id}.`)) : undefined;
  if (raw) rmSync(path.join(RAW, raw), { force: true });
  chunkCache.delete(id);
  log(`remove | ${p.meta.title}`);
  rebuildIndex();
  return true;
}

export function log(line: string): void {
  ensureLibrary();
  appendFileSync(LOG, `- ${nowIso()} | ${line.replace(/\n/g, " ")}\n`);
}

/** The map of content: one line per source, grouped by kind, so the folder reads without the app. */
export function rebuildIndex(): void {
  const sources = existsSync(SRC) ? listSourcesNoIndex() : [];
  const byKind = new Map<string, Source[]>();
  for (const s of sources) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  const out = ["# Library", "", `${sources.length} sources. Each line links the extracted Markdown page; originals are in raw/.`, ""];
  for (const [kind, list] of [...byKind.entries()].sort()) {
    out.push(`## ${kind}`, "");
    for (const s of list) out.push(`- [${s.title}](sources/${s.id}.md) · ${s.pages ? `${s.pages} pages · ` : ""}${s.chunks} passages · added ${s.added.slice(0, 10)}${s.needsOcr?.length ? ` · ${s.needsOcr.length} pages need OCR` : ""}`);
    out.push("");
  }
  atomicWrite(INDEX, out.join("\n"));
}
function listSourcesNoIndex(): Source[] {
  return readdirSync(SRC).filter((n) => n.endsWith(".md")).map((n) => parse(path.join(SRC, n))).filter((x): x is NonNullable<typeof x> => x !== null).map(({ meta, markdown }) => toSource(meta, markdown)).sort((a, b) => b.added.localeCompare(a.added));
}

// ---------------------------------------------------------------- migration from the first layout

/** Move data/sources/<id>.json + .chunks.json (the first layout) into the library. Safe to run repeatedly. */
export function migrateLegacy(): number {
  const old = path.join(DATA_DIR, "sources");
  if (!existsSync(old)) return 0;
  let n = 0;
  for (const name of readdirSync(old)) {
    if (!name.endsWith(".json") || name.endsWith(".chunks.json")) continue;
    const meta = JSON.parse(readFileSync(path.join(old, name), "utf8")) as Partial<Source> & { id: string };
    if (existsSync(path.join(SRC, `${meta.id}.md`))) continue;
    const chunksFile = path.join(old, name.replace(/\.json$/, ".chunks.json"));
    const chunks = existsSync(chunksFile) ? (JSON.parse(readFileSync(chunksFile, "utf8")) as SourceChunk[]) : [];
    const markdown = chunks.map((c) => c.text).join("\n\n");
    ensureLibrary();
    const full: Meta = {
      id: meta.id, title: meta.title ?? meta.id, kind: (meta.kind ?? "text") as SourceKind, origin: meta.origin ?? "", bytes: meta.bytes ?? 0,
      pages: meta.pages, added: meta.added ?? nowIso(), hash: sha256(Buffer.from(markdown)), method: "text", warning: meta.warning,
    };
    atomicWrite(path.join(SRC, `${meta.id}.md`), serialize(full, markdown));
    n++;
  }
  if (n) { log(`migrate | ${n} sources moved from data/sources`); rebuildIndex(); }
  renameSync(old, path.join(DATA_DIR, "sources.migrated"));
  return n;
}

// ---------------------------------------------------------------- fs helpers

function atomicWrite(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
function atomicWriteBytes(file: string, bytes: Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}
