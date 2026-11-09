/**
 * XLSX → Markdown. One "## <sheet name>" section per non-empty sheet with its rows as a
 * Markdown table, capped at 400 rows × 30 columns. Numbers and date serials are left as
 * written; nothing is guessed.
 */
import type { Extracted } from "./extract.js";
import { attr, coreTitle, decodeXml, dropAll, findAll, findFirst, inner, mdTable, openTag, openZip, readRels, zipText, type Zip } from "./zip.js";

export const MAX_ROWS = 400;
export const MAX_COLS = 30;

/** "_x000D_" style escapes used in shared strings. */
function unescapeXlsx(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function tText(xml: string): string {
  return findAll(dropAll(xml, "rPh"), "t").map((t) => decodeXml(unescapeXlsx(inner(t)))).join("");
}

function sharedStrings(zip: Zip): string[] {
  const xml = zipText(zip, "xl/sharedStrings.xml");
  if (!xml) return [];
  return findAll(xml, "si").map(tText);
}

/** "AB12" → 0-based column index 27. */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

interface Sheet { name: string; rows: string[][]; totalRows: number; totalCols: number }

function readSheet(xml: string, shared: string[], name: string): Sheet {
  const rows: string[][] = [];
  let totalRows = 0;
  let totalCols = 0;
  let lastRow = 0;
  for (const row of findAll(xml, "row")) {
    const r = Number(attr(openTag(row), "r")) || lastRow + 1;
    lastRow = r;
    const cells: string[] = [];
    let col = -1;
    for (const c of findAll(row, "c")) {
      const tag = openTag(c);
      const ref = attr(tag, "r");
      col = ref ? colIndex(ref) : col + 1;
      const type = attr(tag, "t") ?? "n";
      let value = "";
      if (type === "s") {
        const idx = Number(decodeXml(inner(findFirst(c, "v") ?? "")).trim());
        value = shared[idx] ?? "";
      } else if (type === "inlineStr") {
        value = tText(findFirst(c, "is") ?? "");
      } else if (type === "b") {
        value = decodeXml(inner(findFirst(c, "v") ?? "")).trim() === "1" ? "TRUE" : "FALSE";
      } else {
        value = decodeXml(inner(findFirst(c, "v") ?? "")).trim();
      }
      if (value === "") continue;
      totalCols = Math.max(totalCols, col + 1);
      if (col < MAX_COLS) cells[col] = value;
    }
    if (!cells.some((v) => v !== undefined && v !== "")) continue;
    totalRows += 1;
    if (rows.length < MAX_ROWS) {
      const width = cells.length;
      rows.push(Array.from({ length: width }, (_, i) => cells[i] ?? ""));
    }
  }
  return { name, rows, totalRows, totalCols };
}

export function extractXlsx(name: string, bytes: Uint8Array, fail: (warning: string) => Extracted, fallbackTitle: string): Extracted {
  const zip = openZip(bytes);
  if (!zip) return fail("This file is not a valid .xlsx (the archive could not be opened). Re-save it from Excel and try again.");
  const workbook = zipText(zip, "xl/workbook.xml");
  if (!workbook) return fail("This workbook has no xl/workbook.xml, so its sheets cannot be found. It may be damaged.");

  const rels = readRels(zip, "xl/_rels/workbook.xml.rels", "xl/workbook.xml");
  const shared = sharedStrings(zip);
  const sheets: Sheet[] = [];
  const sheetTags = findAll(workbook, "sheet");
  sheetTags.forEach((s, i) => {
    const tag = openTag(s);
    const sheetName = attr(tag, "name") || `Sheet ${i + 1}`;
    const rid = attr(tag, "r:id");
    const target = (rid && rels.get(rid)?.target) || `xl/worksheets/sheet${i + 1}.xml`;
    const xml = zipText(zip, target);
    if (!xml) return;
    const sheet = readSheet(xml, shared, sheetName);
    if (sheet.rows.length) sheets.push(sheet);
  });

  if (!sheetTags.length) return fail("No sheets were found in this workbook.");
  if (!sheets.length) return fail("All the sheets in this workbook are empty.");

  const parts = sheets.map((s) => {
    const section = [`## ${s.name}`, "", mdTable(s.rows)];
    const notes: string[] = [];
    if (s.totalRows > MAX_ROWS) notes.push(`the first ${MAX_ROWS} of ${s.totalRows} rows`);
    if (s.totalCols > MAX_COLS) notes.push(`the first ${MAX_COLS} of ${s.totalCols} columns`);
    if (notes.length) section.push("", `_Showing ${notes.join(" and ")}._`);
    return section.join("\n");
  });

  return { title: coreTitle(zip) ?? fallbackTitle, kind: "xlsx", text: parts.join("\n\n"), method: "text" };
}
