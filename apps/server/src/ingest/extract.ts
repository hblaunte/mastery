/**
 * Turn an uploaded file or a URL into text the chunker can split.
 *
 * extractFile never throws: a file we cannot read comes back with text "" (or markers only),
 * method "none" and a `warning` the learner can act on. extractUrl throws UrlError for problems
 * with the URL itself (refused host, unreachable, non-2xx, too large) and otherwise behaves like
 * extractFile on the fetched body.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ExtractionMethod, SourceKind } from "@mastery/shared";
import { htmlToText, collapseWhitespace } from "./html.js";
import { pageMarker } from "./chunk.js";
import { extractPptx } from "./pptx.js";
import { extractEpub } from "./epub.js";
import { extractXlsx } from "./xlsx.js";
import { openZip } from "./zip.js";

export interface Extracted {
  title: string;
  kind: SourceKind;
  text: string;
  pages?: number;
  warning?: string;
  /** "text" when a text layer was read, "none" when nothing usable came out, "ocr"/"mixed" after OCR. */
  method: ExtractionMethod;
  /** 1-based pages (PDF) that have no usable text layer, so the lead can offer OCR. Empty or absent otherwise. */
  needsOcr?: number[];
}

type DetectedKind = SourceKind | "unknown";

const EXT_KIND: Record<string, DetectedKind> = {
  pdf: "pdf", docx: "docx", html: "html", htm: "html", xhtml: "html",
  md: "markdown", markdown: "markdown", mdx: "markdown", txt: "text", text: "text",
  epub: "epub", rst: "text", org: "text", tex: "text", csv: "text", json: "text", log: "text",
  pptx: "pptx", xlsx: "xlsx",
};

const MIME_KIND: Record<string, DetectedKind> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/plain": "text",
  "application/epub+zip": "epub",
};

/** Pre-2007 binary Office formats we do not read; the value is the format to save as. */
const LEGACY_EXT: Record<string, "pptx" | "xlsx" | "docx"> = { ppt: "pptx", pps: "pptx", xls: "xlsx", doc: "docx", rtf: "docx" };
const LEGACY_MIME: Record<string, "pptx" | "xlsx" | "docx"> = {
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.ms-excel": "xlsx",
  "application/msword": "docx",
};

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function mimeOf(mime: string | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

export function detectKind(name: string, mime: string | undefined): DetectedKind {
  const ext = extensionOf(name);
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext]!;
  const m = mimeOf(mime);
  if (m && MIME_KIND[m]) return MIME_KIND[m]!;
  if (m.startsWith("text/")) return "text";
  return "unknown";
}

/** The modern format a legacy binary Office file (.ppt, .xls, .doc) should be saved as, if it is one. */
export function legacyKind(name: string, mime: string | undefined): "pptx" | "xlsx" | "docx" | undefined {
  const ext = extensionOf(name);
  if (ext && LEGACY_EXT[ext]) return LEGACY_EXT[ext];
  if (ext && EXT_KIND[ext]) return undefined;
  return LEGACY_MIME[mimeOf(mime)];
}

export function titleFromFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).replace(/\.[a-z0-9]{1,8}$/i, "");
  const cleaned = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled";
}

function firstHeading(text: string): string | undefined {
  const m = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text);
  return m?.[1]?.trim() || undefined;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
}

/** True when the decoded text is mostly control or replacement characters, i.e. not text. */
function looksBinary(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 20_000);
  let bad = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0)!;
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
  }
  return bad / sample.length > 0.01;
}

function fail(name: string, kind: SourceKind, warning: string, extra: Partial<Extracted> = {}): Extracted {
  return { title: titleFromFilename(name), kind, text: "", warning, method: "none", ...extra };
}

const SUPPORTED = "Supported: PDF, DOCX, PPTX, XLSX, EPUB, HTML, Markdown and plain text.";

// ---------------------------------------------------------------- pdf

/** Fewer non-whitespace characters than this on a page means the page has no usable text layer. */
export const OCR_MIN_CHARS = 40;

/** "3", "12 to 19" and "24" → "Pages 3, 12 to 19 and 24". */
export function describePages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j === i ? `${sorted[i]}` : j === i + 1 ? `${sorted[i]} and ${sorted[j]}` : `${sorted[i]} to ${sorted[j]}`);
    i = j + 1;
  }
  const noun = sorted.length === 1 ? "Page" : "Pages";
  if (runs.length <= 1) return `${noun} ${runs[0] ?? ""}`;
  return `${noun} ${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`;
}

async function extractPdf(name: string, bytes: Uint8Array): Promise<Extracted> {
  const { getDocumentProxy, extractText, getMeta } = await import("unpdf");
  // pdf.js may take ownership of the buffer; hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });

  let title: string | undefined;
  try {
    const meta = (await getMeta(pdf)) as { info?: Record<string, unknown> } | undefined;
    const t = meta?.info?.["Title"];
    if (typeof t === "string" && t.trim() && !/^(untitled|microsoft word|document)/i.test(t.trim())) {
      title = collapseWhitespace(t).replace(/\s+/g, " ");
    }
  } catch { /* metadata is optional */ }

  if (!totalPages) return fail(name, "pdf", "This PDF has no pages.", { pages: 0, title: title ?? titleFromFilename(name) });

  // Every page gets a marker, even an empty one, so OCR output can be merged back page by page.
  const parts: string[] = [];
  const needsOcr: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    const body = collapseWhitespace(pages[i] ?? "");
    if (body.replace(/\s+/g, "").length < OCR_MIN_CHARS) needsOcr.push(i + 1);
    parts.push(body ? `${pageMarker(i + 1).trim()}\n\n${body}` : pageMarker(i + 1).trim());
  }
  const text = parts.join("\n\n");
  const base: Extracted = { title: title ?? titleFromFilename(name), kind: "pdf", text, pages: totalPages, method: "text" };

  if (!needsOcr.length) return base;
  if (needsOcr.length * 2 > totalPages) {
    const all = needsOcr.length === totalPages;
    return {
      ...base,
      method: "none",
      needsOcr,
      warning: all
        ? `No text layer: all ${totalPages} page${totalPages === 1 ? "" : "s"} ${totalPages === 1 ? "is a scan" : "are scans"}. Press Transcribe to read ${totalPages === 1 ? "it" : "them"} with the model.`
        : `${needsOcr.length} of ${totalPages} pages are scans with no text layer. Press Transcribe to read them with the model.`,
    };
  }
  return {
    ...base,
    method: "mixed",
    needsOcr,
    warning: `${describePages(needsOcr)} ${needsOcr.length === 1 ? "is a scan" : "are scans"}; press Transcribe to read ${needsOcr.length === 1 ? "it" : "them"}.`,
  };
}

// ---------------------------------------------------------------- the rest

async function extractDocx(name: string, bytes: Uint8Array): Promise<Extracted> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const text = collapseWhitespace(value ?? "");
  if (!text) return fail(name, "docx", "No text found in this document. It may contain only images.");
  return { title: titleFromFilename(name), kind: "docx", text, method: "text" };
}

function extractHtml(name: string, bytes: Uint8Array, kind: "html" | "url" = "html"): Extracted {
  const { title, text } = htmlToText(decodeText(bytes));
  if (!text) return fail(name, kind, "No readable text on this page. It may be rendered by JavaScript or be behind a login.", { title: title ?? titleFromFilename(name) });
  return { title: title ?? titleFromFilename(name), kind, text, method: "text" };
}

function extractPlain(name: string, bytes: Uint8Array, kind: "markdown" | "text"): Extracted {
  const text = collapseWhitespace(decodeText(bytes));
  if (looksBinary(text)) return fail(name, kind, `This file is not readable as text. ${SUPPORTED}`);
  if (!text) return fail(name, kind, "The file is empty.");
  return { title: firstHeading(text) ?? titleFromFilename(name), kind, text, method: "text" };
}

/** What a PK zip holds, by its tell-tale part. */
function sniffZip(bytes: Uint8Array): "docx" | "pptx" | "xlsx" | "epub" | undefined {
  const zip = openZip(bytes);
  if (!zip) return undefined;
  if (zip["ppt/presentation.xml"]) return "pptx";
  if (zip["xl/workbook.xml"]) return "xlsx";
  if (zip["word/document.xml"]) return "docx";
  if (zip["META-INF/container.xml"] || Object.keys(zip).some((k) => k.toLowerCase().endsWith(".opf"))) return "epub";
  return undefined;
}

/**
 * Dispatch on extension, then MIME type. Never throws.
 */
export async function extractFile(name: string, mime: string | undefined, bytes: Uint8Array): Promise<Extracted> {
  const legacy = legacyKind(name, mime);
  if (legacy) {
    const ext = extensionOf(name) || legacy.slice(0, -1);
    return fail(name, legacy, `Old binary .${ext} files cannot be read. Save it as .${legacy} and add that instead.`);
  }
  const kind = detectKind(name, mime);
  try {
    if (!bytes || bytes.byteLength === 0) {
      return fail(name, kind === "unknown" ? "text" : kind, "The file is empty.");
    }
    const failWith = (k: SourceKind) => (warning: string) => fail(name, k, warning);
    const fallback = titleFromFilename(name);
    switch (kind) {
      case "pdf": return await extractPdf(name, bytes);
      case "docx": return await extractDocx(name, bytes);
      case "pptx": return extractPptx(bytes, failWith("pptx"), fallback);
      case "xlsx": return extractXlsx(bytes, failWith("xlsx"), fallback);
      case "epub": return extractEpub(bytes, failWith("epub"), fallback);
      case "html":
      case "url": return extractHtml(name, bytes);
      case "markdown": return extractPlain(name, bytes, "markdown");
      case "text": return extractPlain(name, bytes, "text");
      case "unknown": {
        // Sniff a few common cases, then fall back to text.
        if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return await extractPdf(name, bytes); // %PDF
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // PK zip: docx, pptx, xlsx or epub
          const inside = sniffZip(bytes);
          if (inside === "pptx") return extractPptx(bytes, failWith("pptx"), fallback);
          if (inside === "xlsx") return extractXlsx(bytes, failWith("xlsx"), fallback);
          if (inside === "epub") return extractEpub(bytes, failWith("epub"), fallback);
          if (inside === "docx") return await extractDocx(name, bytes);
          return fail(name, "text", `Unsupported file type. ${SUPPORTED}`);
        }
        const head = decodeText(bytes.subarray(0, 2048)).trimStart().toLowerCase();
        if (head.startsWith("<!doctype html") || head.startsWith("<html") || /<(head|body|title)\b/.test(head)) return extractHtml(name, bytes);
        return extractPlain(name, bytes, "text");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const k: SourceKind = kind === "unknown" ? "text" : kind;
    if (k === "pdf") return fail(name, k, `Could not read this PDF (${msg}). It may be encrypted or damaged.`);
    if (k === "docx") return fail(name, k, `Could not read this document (${msg}). Re-save it as .docx from Word and try again.`);
    return fail(name, k, `Could not read this file: ${msg}`);
  }
}

// ---------------------------------------------------------------- URLs

export class UrlError extends Error {
  /** 400 for a refused or invalid URL, 502 when the remote failed, 504 on timeout. */
  readonly status: 400 | 502 | 504;
  constructor(message: string, status: 400 | 502 | 504) {
    super(message);
    this.name = "UrlError";
    this.status = status;
  }
}

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("::ffff:")) { // IPv4-mapped
    const v4 = s.slice(7);
    return isIP(v4) === 4 ? isPrivateIPv4(v4) : true;
  }
  const first = parseInt(s.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true;
}

function isForbiddenHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")
    || h.endsWith(".home.arpa") || h.endsWith(".lan") || h === "0.0.0.0" || !h.includes(".") && isIP(h) === 0;
}

/** Basic SSRF guard: http(s) only, no loopback/private/link-local hosts, by name and by resolved address. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new UrlError("That is not a valid URL.", 400); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlError("Only http and https URLs can be added.", 400);
  if (url.username || url.password) throw new UrlError("URLs with embedded credentials are not allowed.", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isForbiddenHostname(host)) throw new UrlError("Local and private network addresses cannot be fetched.", 400);
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UrlError("Local and private network addresses cannot be fetched.", 400);
    return url;
  }
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true }); } catch { throw new UrlError(`Could not resolve the host "${host}".`, 502); }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new UrlError("Local and private network addresses cannot be fetched.", 400);
  }
  return url;
}

function nameFromUrl(url: URL): string {
  const seg = url.pathname.split("/").filter(Boolean).pop();
  return seg && seg.length < 120 ? decodeURIComponent(seg) : url.hostname;
}

/**
 * Fetch with a 20 s total timeout, plain User-Agent, manual redirects (each hop re-checked),
 * then extract by content type. HTML pages come back with kind "url"; a fetched PDF keeps kind "pdf".
 */
export async function extractUrl(input: string): Promise<Extracted> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = await assertSafeUrl(input);
  let res: Response | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "Mastery/0.1",
          Accept: "text/html,application/xhtml+xml,text/markdown,text/plain,application/pdf;q=0.9,*/*;q=0.5",
        },
      });
    } catch (err) {
      if (signal.aborted) throw new UrlError("The page took more than 20 seconds to respond.", 504);
      const msg = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new UrlError(`Could not fetch the page (${msg}).`, 502);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new UrlError(`The server redirected without a destination (HTTP ${res.status}).`, 502);
      if (hop === MAX_REDIRECTS) throw new UrlError("Too many redirects.", 502);
      url = await assertSafeUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res) throw new UrlError("Could not fetch the page.", 502);
  if (!res.ok) throw new UrlError(`The server answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`, 502);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new UrlError("The page is larger than 25 MB.", 502);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    if (signal.aborted) throw new UrlError("The page took more than 20 seconds to download.", 504);
    throw new UrlError("The download was interrupted.", 502);
  }
  if (bytes.byteLength > MAX_BODY_BYTES) throw new UrlError("The page is larger than 25 MB.", 502);

  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const name = nameFromUrl(url);
  const kind = detectKind(name, mime);
  const pageTitle = () => `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;

  if (kind === "html" || kind === "unknown" && (mime === "" || mime.startsWith("text/html"))) {
    const out = extractHtml(name, bytes, "url");
    if (out.title === titleFromFilename(name)) out.title = pageTitle();
    return out;
  }
  const out = await extractFile(name, mime, bytes);
  if (out.kind === "html" || out.kind === "text" && mime.startsWith("text/html")) out.kind = "url";
  if (out.title === titleFromFilename(name) && out.kind === "url") out.title = pageTitle();
  return out;
}
