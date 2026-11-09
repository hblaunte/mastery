/**
 * Small helpers shared by the zip-based extractors (PPTX, XLSX, EPUB).
 *
 * No XML parser: Office and EPUB XML is regular enough that element-by-name regexes work,
 * provided the element name is followed by whitespace, "/>" or ">" (so "<c" never matches
 * "<cols>"). None of the elements we look for nest inside themselves, so non-greedy
 * matching to the closing tag is safe.
 */
import { unzipSync } from "fflate";
import { decodeEntities } from "./html.js";

export type Zip = Record<string, Uint8Array>;

/** Unzip in memory. Returns undefined rather than throwing on a broken archive. */
export function openZip(bytes: Uint8Array): Zip | undefined {
  try {
    const raw = unzipSync(bytes);
    const out: Zip = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.endsWith("/")) continue;
      out[normalisePath(k)] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Strip leading "/" and "./", resolve "." and ".." segments. */
export function normalisePath(p: string): string {
  const segs: string[] = [];
  for (const s of p.replace(/\\/g, "/").split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { segs.pop(); continue; }
    segs.push(s);
  }
  return segs.join("/");
}

/** Resolve `rel` (as found in a .rels Target or an OPF href) against the file `base` lives in. */
export function resolvePath(base: string, rel: string): string {
  let r = rel.split("#")[0]!.split("?")[0]!;
  try { r = decodeURIComponent(r); } catch { /* keep as is */ }
  if (r.startsWith("/")) return normalisePath(r);
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  return normalisePath(dir + r);
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** The UTF-8 text of an entry, or undefined when it is missing. Case-insensitive fallback. */
export function zipText(zip: Zip, path: string): string | undefined {
  const key = normalisePath(path);
  let file = zip[key];
  if (!file) {
    const lower = key.toLowerCase();
    const hit = Object.keys(zip).find((k) => k.toLowerCase() === lower);
    if (hit) file = zip[hit];
  }
  return file ? decoder.decode(file).replace(/^﻿/, "") : undefined;
}

// ---------------------------------------------------------------- xml

/** Remove control characters other than tab and newline. */
export function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Decode XML entities (&amp; &lt; &gt; &quot; &apos; and numeric) and drop control characters. */
export function decodeXml(s: string): string {
  return stripControl(decodeEntities(s));
}

/** Value of attribute `name` on an opening tag string, decoded. */
export function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`[\\s<]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  if (!m) return undefined;
  return decodeXml(m[1] ?? m[2] ?? "");
}

function nameRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches one `<name …>…</name>` or `<name …/>` element. The attribute part is lazy so the
 * "/" of a self-closing tag is never swallowed, and the name must be followed by whitespace,
 * "/>" or ">" so "<c" does not match "<cols>".
 */
function elementRe(name: string, flags = ""): RegExp {
  const n = nameRe(name);
  return new RegExp(`<${n}(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?<\\/${n}\\s*>)`, flags);
}

/** Every `<name …>…</name>` or `<name …/>` element in document order, including its tags. */
export function findAll(xml: string, name: string): string[] {
  return xml.match(elementRe(name, "g")) ?? [];
}

/** Like findAll but also tells where each element starts, for interleaving different element kinds. */
export function findAllAt(xml: string, name: string): { at: number; el: string }[] {
  const out: { at: number; el: string }[] = [];
  for (const m of xml.matchAll(elementRe(name, "g"))) out.push({ at: m.index ?? 0, el: m[0] });
  return out;
}

/** The first `<name …>` element, or undefined. */
export function findFirst(xml: string, name: string): string | undefined {
  return elementRe(name).exec(xml)?.[0];
}

/** The opening tag of an element string (everything up to the first ">"). */
export function openTag(el: string): string {
  const i = el.indexOf(">");
  return i < 0 ? el : el.slice(0, i + 1);
}

/** The content between an element's tags ("" for a self-closing element). */
export function inner(el: string): string {
  if (/\/>$/.test(el) && el.indexOf(">") === el.length - 1) return "";
  const open = el.indexOf(">");
  const close = el.lastIndexOf("</");
  return open < 0 || close < open ? "" : el.slice(open + 1, close);
}

/** Decoded text of all `<tag>` elements inside `xml`, concatenated with `sep`. */
export function textOf(xml: string, tag: string, sep = ""): string {
  return findAll(xml, tag).map((el) => decodeXml(inner(el).replace(/<[^>]*>/g, ""))).join(sep);
}

/** Remove every `<name …>…</name>` element from `xml`. */
export function dropAll(xml: string, name: string): string {
  return xml.replace(elementRe(name, "g"), "");
}

/** Parse a .rels part into Id → { target, type }. Targets are resolved against `partPath`'s directory. */
export function readRels(zip: Zip, relsPath: string, partPath: string): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>();
  const xml = zipText(zip, relsPath);
  if (!xml) return out;
  for (const rel of findAll(xml, "Relationship")) {
    const tag = openTag(rel);
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (!id || !target) continue;
    const external = (attr(tag, "TargetMode") ?? "").toLowerCase() === "external";
    out.set(id, { target: external ? target : resolvePath(partPath, target), type: attr(tag, "Type") ?? "" });
  }
  return out;
}

/** docProps/core.xml → dc:title, when present and not boilerplate. */
export function coreTitle(zip: Zip): string | undefined {
  const core = zipText(zip, "docProps/core.xml");
  if (!core) return undefined;
  const t = textOf(core, "dc:title").replace(/\s+/g, " ").trim();
  if (!t || /^(untitled|presentation\d*|book\d*|workbook\d*|powerpoint presentation|slide ?1)$/i.test(t)) return undefined;
  return t;
}

// ---------------------------------------------------------------- markdown

export function mdCell(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

/** Rows → a Markdown table. The first row is the header; short rows are padded. */
export function mdTable(rows: string[][]): string {
  if (!rows.length) return "";
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => mdCell(r[i] ?? "")).join(" | ")} |`;
  const [head, ...body] = rows;
  return [line(head!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body.map(line)].join("\n");
}
