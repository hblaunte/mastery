/**
 * PPTX → Markdown. One "## Slide N: title" section per slide, preceded by a [[slide N]] marker,
 * with body paragraphs as lines, list levels as "- " nesting, tables as Markdown tables and
 * speaker notes under "Notes:".
 */
import type { Extracted } from "./extract.js";
import { unitMarker } from "./chunk.js";
import { collapseWhitespace } from "./html.js";
import { attr, coreTitle, decodeXml, dropAll, findAll, findAllAt, findFirst, inner, mdTable, openTag, openZip, readRels, resolvePath, zipText, type Zip } from "./zip.js";

/** Placeholder types that hold chrome rather than content. */
const SKIP_PLACEHOLDERS = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);

interface Para { text: string; lvl: number; bullet: boolean }

/** The text of one <a:p>, with fields such as slide numbers removed. */
function paragraph(p: string, inList: boolean): Para | undefined {
  let xml = p;
  // Remove slide-number / date fields, keep other fields' text.
  xml = xml.replace(/<a:fld\b[^>]*type="(slidenum|datetime\d*)"[^>]*>[\s\S]*?<\/a:fld>/gi, "");
  const pPr = findFirst(xml, "a:pPr");
  const lvl = pPr ? Number(attr(openTag(pPr), "lvl") ?? 0) || 0 : 0;
  const buNone = pPr ? /<a:buNone\b/.test(pPr) : false;
  const buExplicit = pPr ? /<a:bu(Char|AutoNum|Blip)\b/.test(pPr) : false;
  const bullet = !buNone && (inList || buExplicit || lvl > 0);
  const pieces: string[] = [];
  for (const m of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t\s*>|<a:t\s*\/>|<a:br\s*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g)) {
    if (m[0].startsWith("<a:br")) pieces.push("\n");
    else pieces.push(decodeXml(m[1] ?? ""));
  }
  const text = pieces.join("").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  if (!text) return undefined;
  return { text, lvl, bullet };
}

function renderParas(paras: Para[]): string[] {
  const lines: string[] = [];
  for (const p of paras) {
    if (p.bullet) {
      const indent = "  ".repeat(p.lvl);
      const [first, ...rest] = p.text.split("\n");
      lines.push(`${indent}- ${first}`);
      for (const r of rest) lines.push(`${indent}  ${r}`);
    } else {
      lines.push(p.text);
    }
  }
  return lines;
}

/** Placeholder type of a shape ("body" when <p:ph> has no type), or undefined for a free shape. */
function placeholderType(sp: string): string | undefined {
  const nv = findFirst(sp, "p:nvSpPr");
  if (!nv) return undefined;
  const ph = /<p:ph\b[^>]*\/?>/.exec(nv)?.[0];
  if (!ph) return undefined;
  return attr(ph, "type") ?? "body";
}

function tableToMarkdown(tbl: string): string {
  const rows: string[][] = [];
  for (const tr of findAll(tbl, "a:tr")) {
    const cells = findAll(tr, "a:tc").map((tc) => {
      const paras = findAll(tc, "a:p").map((p) => paragraph(p, false)?.text ?? "").filter(Boolean);
      return paras.join(" ");
    });
    if (cells.some((c) => c)) rows.push(cells);
  }
  return mdTable(rows);
}

interface SlideText { title?: string; lines: string[] }

/** Walk the shapes of a slide (or notes slide) in document order. */
function slideContent(xml: string, opts: { titleFromPlaceholder: boolean }): SlideText {
  const tree = findFirst(xml, "p:spTree") ?? xml;
  const items = [
    ...findAllAt(tree, "p:sp").map((x) => ({ ...x, kind: "sp" as const })),
    ...findAllAt(tree, "a:tbl").map((x) => ({ ...x, kind: "tbl" as const })),
  ].sort((a, b) => a.at - b.at);

  let title: string | undefined;
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind === "tbl") {
      const md = tableToMarkdown(item.el);
      if (md) lines.push("", md, "");
      continue;
    }
    const ph = placeholderType(item.el);
    if (ph && SKIP_PLACEHOLDERS.has(ph)) continue;
    const body = findFirst(item.el, "p:txBody");
    if (!body) continue;
    const isTitle = opts.titleFromPlaceholder && (ph === "title" || ph === "ctrTitle");
    const inList = ph === "body" && !isTitle;
    const paras = findAll(body, "a:p").map((p) => paragraph(p, inList)).filter((p): p is Para => Boolean(p));
    if (!paras.length) continue;
    if (isTitle && title === undefined) {
      title = paras.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(...renderParas(paras));
  }
  return { title, lines };
}

/** Slide parts in presentation order: from presentation.xml + rels, else by file number. */
function slidePaths(zip: Zip): string[] {
  const pres = zipText(zip, "ppt/presentation.xml");
  const rels = readRels(zip, "ppt/_rels/presentation.xml.rels", "ppt/presentation.xml");
  const ordered: string[] = [];
  if (pres) {
    for (const sld of findAll(pres, "p:sldId")) {
      const rid = attr(openTag(sld), "r:id") ?? attr(openTag(sld), "id");
      const rel = rid ? rels.get(rid) : undefined;
      if (rel && zipText(zip, rel.target) !== undefined) ordered.push(rel.target);
    }
  }
  if (ordered.length) return ordered;
  return Object.keys(zip)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
}

function notesFor(zip: Zip, slidePath: string): string[] {
  const file = slidePath.slice(slidePath.lastIndexOf("/") + 1);
  const relsPath = resolvePath(slidePath, `_rels/${file}.rels`);
  const rels = readRels(zip, relsPath, slidePath);
  const notes = [...rels.values()].find((r) => /\/notesSlide$/i.test(r.type));
  if (!notes) return [];
  const xml = zipText(zip, notes.target);
  if (!xml) return [];
  const { lines } = slideContent(xml, { titleFromPlaceholder: false });
  return lines;
}

export function extractPptx(name: string, bytes: Uint8Array, fail: (warning: string) => Extracted, fallbackTitle: string): Extracted {
  const zip = openZip(bytes);
  if (!zip) return fail("This file is not a valid .pptx (the archive could not be opened). Re-save it from PowerPoint and try again.");
  const paths = slidePaths(zip);
  if (!paths.length) return fail("No slides were found in this presentation. It may be damaged or not a .pptx at all.");

  const parts: string[] = [];
  let firstTitle: string | undefined;
  let contentChars = 0;
  paths.forEach((path, i) => {
    const n = i + 1;
    const xml = zipText(zip, path) ?? "";
    const { title, lines } = slideContent(dropAll(xml, "p:extLst"), { titleFromPlaceholder: true });
    if (title && !firstTitle) firstTitle = title;
    const body = collapseWhitespace(lines.join("\n"));
    const notes = collapseWhitespace(notesFor(zip, path).join("\n"));
    contentChars += body.length + notes.length + (title?.length ?? 0);
    const section = [`## Slide ${n}${title ? `: ${title}` : ""}`];
    if (body) section.push("", body);
    if (notes) section.push("", "Notes:", notes);
    parts.push(unitMarker("slide", n).trim(), section.join("\n"));
  });

  if (!contentChars) return fail(`No text was found on the ${paths.length} slide${paths.length === 1 ? "" : "s"}; they may be pictures only.`);
  return {
    title: coreTitle(zip) ?? firstTitle ?? fallbackTitle,
    kind: "pptx",
    text: parts.join("\n\n"),
    pages: paths.length,
    method: "text",
  };
}
