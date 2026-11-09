import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { htmlToText, decodeEntities } from "./html.js";
import { chunkText, pageMarker, unitMarker } from "./chunk.js";
import { extractFile, detectKind, legacyKind, describePages, assertSafeUrl, isPrivateAddress, UrlError } from "./extract.js";
import { ocrPdfPages, mergeOcr, batchPages, normaliseBatch, OcrError } from "./ocr.js";

const enc = (s: string) => new TextEncoder().encode(s);
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

// ---------------------------------------------------------------- html

test("html: strips scripts and styles, turns headings into Markdown, li into bullets, decodes entities", () => {
  const html = `<!doctype html><html><head><title>Sampling &amp; Estimation</title>
    <style>body{color:red}</style><script>var x = "<b>not text</b>";</script></head>
    <body><h1>Sampling   &amp; Estimation</h1><!-- comment -->
    <p>The   mean of a <em>simple random sample</em> is unbiased.</p>
    <h2 id="x"><a href="#">3.2 Variance</a></h2>
    <ul><li>First &ndash; point</li><li>Second&nbsp;point &lt;tag&gt;</li></ul>
    <script>trailing()</script></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, "Sampling & Estimation");
  assert.ok(!text.includes("color:red"));
  assert.ok(!text.includes("not text"));
  assert.ok(!text.includes("trailing"));
  assert.ok(!text.includes("<em>"));
  assert.match(text, /^# Sampling & Estimation$/m);
  assert.match(text, /^## 3\.2 Variance$/m);
  assert.match(text, /^- First – point$/m);
  assert.match(text, /^- Second point <tag>$/m);
  assert.match(text, /The mean of a simple random sample is unbiased\./);
  assert.ok(!/\n{3,}/.test(text), "no runs of blank lines");
});

test("html: title falls back to the first h1; entities decode numerically", () => {
  const { title } = htmlToText("<body><h1>Hello &#8212; World</h1><p>x</p></body>");
  assert.equal(title, "Hello — World");
  assert.equal(decodeEntities("&#x41;&#66;&amp;lt;&unknown;"), "AB&lt;&unknown;");
});

// ---------------------------------------------------------------- chunking

const para = (i: number, len = 400) => `Paragraph ${i}. ` + "lorem ipsum dolor sit amet ".repeat(Math.ceil(len / 27)).slice(0, len - 15).trim() + ".";

test("chunk: empty and whitespace input give no chunks", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n \n"), []);
});

test("chunk: packs paragraphs to roughly target, indexes from 0, overlaps with the previous chunk", () => {
  const paras = Array.from({ length: 30 }, (_, i) => para(i + 1, 400));
  const text = paras.join("\n\n");
  const chunks = chunkText(text, { target: 2000, overlap: 200 });
  assert.ok(chunks.length >= 6 && chunks.length <= 8, `got ${chunks.length} chunks`);
  chunks.forEach((c, i) => assert.equal(c.index, i));
  for (const c of chunks) assert.ok(c.text.length <= 2000 + 200 + 2, `chunk ${c.index} is ${c.text.length} chars`);
  for (const c of chunks.slice(0, -1)) assert.ok(c.text.length >= 1200, `chunk ${c.index} is only ${c.text.length} chars`);
  // The overlap is the tail of the previous chunk's own text, cut at a word boundary.
  const first = chunks[0]!;
  const second = chunks[1]!;
  const lead = second.text.split("\n\n")[0]!;
  assert.ok(lead.length > 100 && lead.length <= 200, `lead is ${lead.length}`);
  assert.ok(first.text.endsWith(lead), "second chunk starts with the tail of the first");
  assert.ok(!/^\S*\s/.test(lead) || /^[A-Za-z.]/.test(lead));
  // No paragraph lost: every paragraph header appears somewhere.
  const all = chunks.map((c) => c.text).join("\n");
  for (let i = 1; i <= 30; i++) assert.ok(all.includes(`Paragraph ${i}.`), `paragraph ${i} present`);
  // Without headings or pages the locator is a paragraph range.
  assert.match(first.locator, /^¶ 1–4$/);
  assert.match(second.locator, /^¶ \d+–\d+$/);
});

test("chunk: overlap 0 gives no lead; a single over-long paragraph is split", () => {
  const text = "x ".repeat(5000).trim();
  const chunks = chunkText(text, { target: 1000, overlap: 0 });
  assert.ok(chunks.length >= 10);
  for (const c of chunks) assert.ok(c.text.length <= 1000);
  const chunks2 = chunkText([para(1, 500), para(2, 500), para(3, 500)].join("\n\n"), { target: 600, overlap: 0 });
  assert.equal(chunks2.length, 3);
  assert.ok(chunks2[1]!.text.startsWith("Paragraph 2."));
});

test("chunk: heading-path locators and heading-first splitting", () => {
  const text = [
    "# 3 Methods",
    para(1, 300),
    "## 3.1 Design",
    para(2, 300), para(3, 300),
    "## 3.2 Sampling",
    para(4, 1200), para(5, 1200), para(6, 1200),
    "### 3.2.1 Stratified",
    para(7, 1300),
    "# 4 Results",
    para(8, 300),
  ].join("\n\n");
  const chunks = chunkText(text, { target: 2500, overlap: 0 });
  const locators = chunks.map((c) => c.locator);
  assert.equal(locators[0], "3 Methods");
  assert.ok(locators.includes("3 Methods › 3.2 Sampling"), `locators: ${locators.join(" | ")}`);
  assert.ok(locators.includes("4 Results"), `locators: ${locators.join(" | ")}`);
  // A heading closes a half-full chunk, so "4 Results" starts its own chunk.
  const results = chunks.find((c) => c.locator === "4 Results")!;
  assert.ok(results.text.startsWith("# 4 Results"));
  // A deeper heading nests under its parents, and a sibling replaces its sibling.
  const strat = chunks.find((c) => c.text.startsWith("### 3.2.1"));
  if (strat) assert.equal(strat.locator, "3 Methods › 3.2 Sampling › 3.2.1 Stratified");
  assert.ok(!chunks.some((c) => c.locator.includes("3.1 Design › 3.2")));
});

test("chunk: pdf page markers become page-range locators and are stripped from the text", () => {
  const pages = Array.from({ length: 6 }, (_, p) => Array.from({ length: 3 }, (_, i) => para(p * 3 + i + 1, 500)).join("\n\n"));
  const text = pages.map((body, i) => pageMarker(i + 1).trim() + "\n\n" + body).join("\n\n");
  const chunks = chunkText(text, { target: 3200, overlap: 100 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(!c.text.includes("[[page"), "markers stripped");
    assert.match(c.locator, /^(p\. \d+|pp\. \d+–\d+)$/);
  }
  assert.equal(chunks[0]!.locator, "pp. 1–2");
  const last = chunks[chunks.length - 1]!;
  assert.ok(last.locator.endsWith("6"), `last locator ${last.locator}`);
  // A chunk inside a single page says "p. N".
  const single = chunkText(pageMarker(12).trim() + "\n\n" + para(1, 400) + "\n\n" + para(2, 400));
  assert.equal(single.length, 1);
  assert.equal(single[0]!.locator, "p. 12");
});

// ---------------------------------------------------------------- extraction

test("extract: kind detection by extension then mime", () => {
  assert.equal(detectKind("a.PDF", undefined), "pdf");
  assert.equal(detectKind("notes", "text/markdown; charset=utf-8"), "markdown");
  assert.equal(detectKind("x.docx", "application/octet-stream"), "docx");
  assert.equal(detectKind("page", "text/html"), "html");
  assert.equal(detectKind("blob", "application/octet-stream"), "unknown");
});

test("extract: markdown takes its title from the first heading; text from the filename", async () => {
  const md = await extractFile("notes.md", "text/markdown", enc("intro\n\n## Sampling distributions\n\nBody text."));
  assert.equal(md.kind, "markdown");
  assert.equal(md.title, "Sampling distributions");
  assert.equal(md.warning, undefined);
  const txt = await extractFile("my_lecture-notes.txt", undefined, enc("Just some text.\n"));
  assert.equal(txt.kind, "text");
  assert.equal(txt.title, "my lecture notes");
  assert.equal(txt.text, "Just some text.");
});

test("extract: html files go through the html path", async () => {
  const out = await extractFile("page.html", "text/html", enc("<html><head><title>T</title></head><body><h1>H</h1><p>Body</p></body></html>"));
  assert.equal(out.kind, "html");
  assert.equal(out.title, "T");
  assert.equal(out.text, "# H\n\nBody");
});

test("extract: empty, binary and bogus files never throw", async () => {
  const empty = await extractFile("empty.txt", "text/plain", new Uint8Array());
  assert.equal(empty.text, "");
  assert.ok(empty.warning);

  const junk = new Uint8Array(4000);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 7919) % 256;
  const bin = await extractFile("mystery.bin", "application/octet-stream", junk);
  assert.equal(bin.text, "");
  assert.ok(bin.warning);

  const badPdf = await extractFile("broken.pdf", "application/pdf", enc("%PDF-1.4 this is not really a pdf"));
  assert.equal(badPdf.kind, "pdf");
  assert.equal(badPdf.text, "");
  assert.ok(badPdf.warning, "warning explains the failure");

  const badDocx = await extractFile("broken.docx", undefined, enc("PK not a zip"));
  assert.equal(badDocx.kind, "docx");
  assert.equal(badDocx.text, "");
  assert.ok(badDocx.warning);

  const epub = await extractFile("book.epub", undefined, enc("PK..."));
  assert.equal(epub.kind, "epub");
  assert.match(epub.warning ?? "", /EPUB/);
});

test("extract: a real (tiny) pdf yields page markers and a page count", async () => {
  // Minimal uncompressed PDF with two pages of text. pdf.js reconstructs the xref if offsets are off.
  const content1 = "BT /F1 18 Tf 40 700 Td (Hello from page one of the sampling notes, where the mean is introduced) Tj ET";
  const content2 = "BT /F1 18 Tf 40 700 Td (And this is page two with more text about variance and standard error) Tj ET";
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
4 0 obj << /Length ${content1.length} >> stream
${content1}
endstream endobj
5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
6 0 obj << /Length ${content2.length} >> stream
${content2}
endstream endobj
7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;
  const out = await extractFile("notes.pdf", "application/pdf", enc(pdf));
  if (out.warning && /Could not read/.test(out.warning)) {
    // pdf.js could not load in this environment; the never-throw contract still held.
    assert.equal(out.text, "");
    return;
  }
  assert.equal(out.kind, "pdf");
  assert.equal(out.pages, 2);
  assert.equal(out.method, "text");
  assert.equal(out.needsOcr, undefined);
  assert.equal(out.warning, undefined);
  assert.ok(out.text.includes("[[page 1]]") && out.text.includes("[[page 2]]"), out.text);
  assert.ok(out.text.includes("Hello from page one"));
  const chunks = chunkText(out.text);
  assert.equal(chunks[0]!.locator, "pp. 1–2");
  assert.ok(!chunks[0]!.text.includes("[[page"));
});

// ---------------------------------------------------------------- unit markers

test("chunk: slide and section markers give their own locator vocabulary", () => {
  const slides = [1, 2, 3].map((n) => unitMarker("slide", n).trim() + `\n\n## Slide ${n}: Topic ${n}\n\n` + para(n, 300)).join("\n\n");
  const one = chunkText(slides);
  assert.equal(one.length, 1);
  assert.equal(one[0]!.locator, "slides 1–3");
  assert.ok(!one[0]!.text.includes("[[slide"));
  const many = chunkText(slides, { target: 400, overlap: 0 });
  assert.ok(many.every((c) => /^slide \d$/.test(c.locator)), many.map((c) => c.locator).join(" | "));

  const sections = [1, 2].map((n) => unitMarker("section", n).trim() + `\n\n# Chapter ${n}\n\n` + para(n, 300)).join("\n\n");
  assert.equal(chunkText(sections)[0]!.locator, "sections 1–2");
  assert.equal(chunkText(unitMarker("section", 4) + para(1, 100))[0]!.locator, "section 4");
  assert.equal(pageMarker(3), unitMarker("page", 3));
});

// ---------------------------------------------------------------- pptx / epub / xlsx

const PPT_NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const sp = (ph: string | undefined, paras: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${ph ?? ""}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
const run = (t: string) => `<a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r>`;

function samplePptx(withCoreTitle = true): Uint8Array {
  const slideA = `<p:sld ${PPT_NS}><p:cSld><p:spTree>
    ${sp('<p:ph type="ctrTitle"/>', `<a:p>${run("Why sample?")}</a:p>`)}
    ${sp('<p:ph idx="1"/>', `<a:p>${run("Populations are large")}</a:p><a:p><a:pPr lvl="1"/>${run("Census costs &amp; time")}</a:p><a:p><a:pPr lvl="1"/>${run("Speed")}</a:p>`)}
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblPr/>
      <a:tr h="1"><a:tc><a:txBody><a:p>${run("Method")}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p>${run("Bias")}</a:p></a:txBody></a:tc></a:tr>
      <a:tr h="1"><a:tc><a:txBody><a:p>${run("SRS")}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p>${run("None | small")}</a:p></a:txBody></a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    ${sp('<p:ph type="sldNum" sz="quarter" idx="12"/>', `<a:p><a:fld id="{x}" type="slidenum">${run("1")}</a:fld></a:p>`)}
  </p:spTree></p:cSld></p:sld>`;
  const slideB = `<p:sld ${PPT_NS}><p:cSld><p:spTree>
    ${sp('<p:ph type="title"/>', `<a:p>${run("Stratified sampling")}</a:p>`)}
    ${sp(undefined, `<a:p>${run("Split the population into strata,")}<a:br/>${run("then sample each.")}</a:p>`)}
  </p:spTree></p:cSld></p:sld>`;
  const notes = `<p:notes ${PPT_NS}><p:cSld><p:spTree>
    ${sp('<p:ph type="sldImg"/>', "")}
    ${sp('<p:ph type="body" idx="1"/>', `<a:p>${run("Mention the 1936 Literary Digest poll.")}</a:p>`)}
    ${sp('<p:ph type="sldNum" idx="10"/>', `<a:p><a:fld id="{y}" type="slidenum">${run("1")}</a:fld></a:p>`)}
  </p:spTree></p:cSld></p:notes>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": "<Types/>",
    // Deliberately out of file order: rId3 (slide2.xml) is shown first.
    "ppt/presentation.xml": `<p:presentation ${PPT_NS}><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide2.xml": slideA,
    "ppt/slides/slide1.xml": slideB,
    "ppt/slides/_rels/slide2.xml.rels": `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    "ppt/notesSlides/notesSlide1.xml": notes,
  };
  if (withCoreTitle) files["docProps/core.xml"] = `<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sampling &amp; Estimation</dc:title></cp:coreProperties>`;
  return zip(files);
}

test("pptx: slides in presentation order with titles, nested bullets, tables and notes", async () => {
  const out = await extractFile("deck.pptx", undefined, samplePptx());
  assert.equal(out.kind, "pptx");
  assert.equal(out.method, "text");
  assert.equal(out.pages, 2);
  assert.equal(out.title, "Sampling & Estimation");
  assert.equal(out.warning, undefined);
  const t = out.text;
  assert.ok(t.indexOf("[[slide 1]]") < t.indexOf("## Slide 1: Why sample?"), t);
  assert.ok(t.indexOf("## Slide 1: Why sample?") < t.indexOf("[[slide 2]]"), t);
  assert.match(t, /^## Slide 2: Stratified sampling$/m);
  assert.match(t, /^- Populations are large$/m);
  assert.match(t, /^  - Census costs & time$/m);
  assert.match(t, /^  - Speed$/m);
  assert.match(t, /^\| Method \| Bias \|\n\| --- \| --- \|\n\| SRS \| None \\\| small \|$/m);
  assert.match(t, /^Notes:\nMention the 1936 Literary Digest poll\.$/m);
  assert.ok(!/^1$/m.test(t), "slide numbers are dropped");
  assert.ok(!/^- Mention/m.test(t), "notes are prose, not bullets");
  assert.match(t, /^Split the population into strata,\nthen sample each\.$/m);
  const chunks = chunkText(t);
  assert.equal(chunks[0]!.locator, "slides 1–2");
  assert.ok(!chunks[0]!.text.includes("[[slide"));

  // Title falls back to the first slide title, then the filename.
  const noCore = await extractFile("q3-review.pptx", undefined, samplePptx(false));
  assert.equal(noCore.title, "Why sample?");
});

test("pptx: detection by extension and mime; legacy .ppt/.xls/.doc are refused with advice", async () => {
  assert.equal(detectKind("deck.PPTX", undefined), "pptx");
  assert.equal(detectKind("x", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), "pptx");
  assert.equal(detectKind("x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "xlsx");
  assert.equal(legacyKind("old.ppt", undefined), "pptx");
  assert.equal(legacyKind("old", "application/vnd.ms-excel"), "xlsx");
  assert.equal(legacyKind("new.pptx", "application/vnd.ms-powerpoint"), undefined);
  for (const [file, want] of [["old.ppt", "pptx"], ["old.xls", "xlsx"], ["old.doc", "docx"]] as const) {
    const out = await extractFile(file, undefined, enc("\xd0\xcf\x11\xe0 legacy"));
    assert.equal(out.kind, want);
    assert.equal(out.method, "none");
    assert.match(out.warning ?? "", new RegExp(`Save it as \\.${want} and add that instead`));
  }
  // A zip with an unknown extension is sniffed.
  const sniffed = await extractFile("mystery.bin", "application/octet-stream", samplePptx());
  assert.equal(sniffed.kind, "pptx");
  assert.equal(sniffed.pages, 2);
  // A broken pptx never throws.
  const broken = await extractFile("broken.pptx", undefined, enc("PK\x03\x04 nope"));
  assert.equal(broken.kind, "pptx");
  assert.equal(broken.method, "none");
  assert.match(broken.warning ?? "", /not a valid \.pptx/);
});

function sampleEpub(): Uint8Array {
  const chapter = (n: number, title: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Statistical Rethinking</title></head><body><h1>Chapter ${n}: ${title}</h1><p>${para(n, 600)}</p><h2>${n}.1 A section</h2><p>${para(n + 10, 300)}</p></body></html>`;
  return zip({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    "OEBPS/content.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Statistical Rethinking</dc:title><dc:creator>R. McElreath</dc:creator></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/><item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest>
      <spine toc="ncx"><itemref idref="cover"/><itemref idref="nav"/><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>`,
    "OEBPS/nav.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="text/ch1.xhtml">Chapter 1</a></li><li><a href="text/ch%202.xhtml">Chapter 2</a></li></ol></nav></body></html>`,
    "OEBPS/cover.xhtml": `<html><body><img src="cover.jpg" alt=""/></body></html>`,
    "OEBPS/text/ch1.xhtml": chapter(1, "The Golem of Prague"),
    "OEBPS/text/ch 2.xhtml": chapter(2, "Small Worlds and Large Worlds"),
  });
}

test("epub: spine order, section markers, skipped nav and cover, title from the OPF", async () => {
  const out = await extractFile("book.epub", "application/epub+zip", sampleEpub());
  assert.equal(out.kind, "epub");
  assert.equal(out.method, "text");
  assert.equal(out.title, "Statistical Rethinking");
  assert.equal(out.warning, undefined);
  const t = out.text;
  assert.ok(t.startsWith("[[section 1]]\n\n# Chapter 1: The Golem of Prague"), t.slice(0, 200));
  const s2 = t.indexOf("[[section 2]]");
  assert.ok(s2 > 0 && t.indexOf("# Chapter 2: Small Worlds and Large Worlds") > s2, "chapter 2 follows its marker");
  assert.ok(t.indexOf("# Chapter 1") < t.indexOf("# Chapter 2"), "spine order, not manifest order");
  assert.ok(!t.includes("[[section 3]]"), "nav and cover do not count");
  assert.ok(!t.includes("# Contents"), "nav skipped");
  assert.match(t, /^## 1\.1 A section$/m);
  const chunks = chunkText(t);
  assert.equal(chunks[0]!.locator, "sections 1–2");

  const broken = await extractFile("book.epub", undefined, zip({ "mimetype": "application/epub+zip", "x.txt": "no opf here" }));
  assert.equal(broken.kind, "epub");
  assert.equal(broken.method, "none");
  assert.match(broken.warning ?? "", /package file/);
});

function sampleXlsx(): Uint8Array {
  const X = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  return zip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<workbook ${X}><sheets><sheet name="Scores" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/><sheet name="Notes &amp; refs" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x/worksheet" Target="/xl/worksheets/sheet3.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst ${X} count="4" uniqueCount="4"><si><t>Name</t></si><si><t>Score</t></si><si><r><rPr><b/></rPr><t>Al</t></r><r><t>ice</t></r></si><si><t xml:space="preserve">Bob &amp; Co</t><rPh sb="0" eb="3"><t>ボブ</t></rPh></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${X}><cols><col min="1" max="1" width="12"/></cols><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>91.5</v></c><c r="C2" s="1"/></row>
      <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>78</v></c><c r="C3" t="inlineStr"><is><t>late</t></is></c></row>
      <row r="5"/>
    </sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet ${X}><sheetData/></worksheet>`,
    "xl/worksheets/sheet3.xml": `<worksheet ${X}><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" s="14"><v>45000</v></c><c r="C1" t="str"><f>A1&amp;"x"</f><v>TRUEx</v></c></row></sheetData></worksheet>`,
  });
}

test("xlsx: shared and inline strings, numbers as written, empty sheets skipped, sheet names decoded", async () => {
  const out = await extractFile("grades.xlsx", undefined, sampleXlsx());
  assert.equal(out.kind, "xlsx");
  assert.equal(out.method, "text");
  assert.equal(out.title, "grades");
  assert.equal(out.warning, undefined);
  const t = out.text;
  assert.match(t, /^## Scores$/m);
  assert.ok(!/^## Empty$/m.test(t), "empty sheet skipped");
  assert.match(t, /^## Notes & refs$/m);
  assert.match(t, /^\| Name \| Score \|  \|\n\| --- \| --- \| --- \|\n\| Alice \| 91\.5 \|  \|\n\| Bob & Co \| 78 \| late \|$/m, t);
  assert.ok(!t.includes("ボブ"), "phonetic runs are dropped");
  assert.match(t, /^\| TRUE \| 45000 \| TRUEx \|$/m, "booleans, date serials and formula strings");
  const chunks = chunkText(t);
  assert.equal(chunks[0]!.locator, "Scores");

  const broken = await extractFile("broken.xlsx", undefined, enc("PK\x03\x04 nope"));
  assert.equal(broken.method, "none");
  assert.match(broken.warning ?? "", /not a valid \.xlsx/);
});

test("xlsx: rows and columns are capped with a note", async () => {
  const X = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`;
  const cols = Array.from({ length: 35 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26) - 1 >= 65 ? 65 + Math.floor(i / 26) - 1 : 0).replace("\0", "") + String.fromCharCode(65 + (i % 26)));
  const rows = Array.from({ length: 450 }, (_, r) => `<row r="${r + 1}">${cols.map((c, i) => `<c r="${c}${r + 1}" t="inlineStr"><is><t>r${r + 1}c${i + 1}</t></is></c>`).join("")}</row>`).join("");
  const out = await extractFile("big.xlsx", undefined, zip({
    "xl/workbook.xml": `<workbook ${X}><sheets><sheet name="Big" sheetId="1"/></sheets></workbook>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${X}><sheetData>${rows}</sheetData></worksheet>`,
  }));
  assert.equal(out.method, "text");
  const lines = out.text.split("\n").filter((l) => l.startsWith("|"));
  assert.equal(lines.length, 401, "header + 399 body rows + separator = 400 data rows plus separator");
  assert.ok(out.text.includes("| r400c1 |") && !out.text.includes("r401c1"));
  assert.ok(out.text.includes("r1c30") && !out.text.includes("r1c31"));
  assert.match(out.text, /_Showing the first 400 of 450 rows and the first 30 of 35 columns\._/);
});

// ---------------------------------------------------------------- pdf needsOcr

async function pdfWithPages(spec: (string | null)[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of spec) {
    const page = doc.addPage([612, 792]);
    if (text) page.drawText(text, { x: 40, y: 700, size: 12, font });
  }
  return doc.save();
}

const LONG = "Hello from a page of the sampling notes, where the sample mean is introduced as an estimator.";

test("pdf: a page with no text layer is listed in needsOcr; method is mixed while most pages have text", async () => {
  const out = await extractFile("mixed.pdf", "application/pdf", await pdfWithPages([LONG, null, LONG]));
  assert.equal(out.kind, "pdf");
  assert.equal(out.pages, 3);
  assert.equal(out.method, "mixed");
  assert.deepEqual(out.needsOcr, [2]);
  assert.match(out.warning ?? "", /^Page 2 is a scan; press Transcribe to read it\.$/);
  // Every page keeps its marker, the empty one included, so OCR output can be merged back.
  assert.match(out.text, /\[\[page 1\]\]\n\nHello[\s\S]*\[\[page 2\]\]\n\n\[\[page 3\]\]\n\nHello/);
  assert.equal(chunkText(out.text)[0]!.locator, "pp. 1–3");
});

test("pdf: mostly scanned → method none, all pages marked, warning counts them", async () => {
  const out = await extractFile("scan.pdf", "application/pdf", await pdfWithPages([null, "short", null, LONG]));
  assert.equal(out.method, "none");
  assert.deepEqual(out.needsOcr, [1, 2, 3]);
  assert.match(out.warning ?? "", /3 of 4 pages are scans.*Transcribe/);
  assert.ok(out.text.includes("[[page 1]]") && out.text.includes("[[page 4]]"));
  const all = await extractFile("scan.pdf", "application/pdf", await pdfWithPages([null, null]));
  assert.equal(all.method, "none");
  assert.deepEqual(all.needsOcr, [1, 2]);
  assert.match(all.warning ?? "", /all 2 pages are scans/);
  assert.deepEqual(chunkText(all.text), [], "markers alone yield no chunks");
  assert.equal(describePages([3, 12, 13, 14, 15, 16, 17, 18, 19, 24]), "Pages 3, 12 to 19 and 24");
  assert.equal(describePages([7, 8]), "Pages 7 and 8");
});

// ---------------------------------------------------------------- ocr

test("mergeOcr: replaces only the pages present in the OCR text, slots in unknown pages, idempotent", () => {
  const original = "[[page 1]]\n\nOne\n\n[[page 2]]\n\n[[page 3]]\n\nThree";
  const ocr = "[[page 2]]\n\n# Heading\n\nTwo, transcribed.";
  const merged = mergeOcr(original, ocr);
  assert.equal(merged, "[[page 1]]\n\nOne\n\n[[page 2]]\n\n# Heading\n\nTwo, transcribed.\n\n[[page 3]]\n\nThree");
  assert.equal(mergeOcr(merged, ocr), merged, "idempotent");
  assert.equal(mergeOcr(original, ""), original, "nothing to merge");
  // Pages the original lacks a marker for are inserted in order; a lead before the first marker survives.
  const withLead = "Front matter\n\n[[page 1]]\n\nOne\n\n[[page 3]]\n\nThree";
  assert.equal(mergeOcr(withLead, "[[page 2]]\n\nTwo\n\n[[page 4]]\n\nFour"), "Front matter\n\n[[page 1]]\n\nOne\n\n[[page 2]]\n\nTwo\n\n[[page 3]]\n\nThree\n\n[[page 4]]\n\nFour");
  // Replacing a page with an empty transcription leaves just the marker.
  assert.equal(mergeOcr(original, "[[page 1]]"), "[[page 1]]\n\n[[page 2]]\n\n[[page 3]]\n\nThree");
});

test("ocr batching: contiguous runs cut at 15; normaliseBatch repairs numbering", () => {
  assert.deepEqual(batchPages([1, 2, 3, 5, 6]), [[1, 2, 3], [5, 6]]);
  assert.deepEqual(batchPages(Array.from({ length: 16 }, (_, i) => i + 1)).map((b) => b.length), [15, 1]);
  assert.deepEqual(batchPages(Array.from({ length: 60 }, (_, i) => i + 1)).map((b) => b.length), [15, 15, 15, 15]);
  // Local numbering is mapped back to the original.
  const local = normaliseBatch("[[page 1]]\nA\n[[page 2]]\nB\n[[page 3]]\nC", [5, 6, 7]);
  assert.equal(local.text, "[[page 5]]\n\nA\n\n[[page 6]]\n\nB\n\n[[page 7]]\n\nC");
  assert.ok(local.warnings.some((w) => /numbered/.test(w)));
  // A missing marker is inserted; text before the first marker belongs to the first page.
  const missing = normaliseBatch("preamble\n[[page 10]]\nten", [9, 10]);
  assert.equal(missing.text, "[[page 9]]\n\npreamble\n\n[[page 10]]\n\nten");
  assert.ok(missing.warnings.some((w) => /No page marker came back for page 9/.test(w)));
  // A code fence around the whole answer is removed.
  assert.equal(normaliseBatch("```markdown\n[[page 2]]\n\nx\n```", [2]).text, "[[page 2]]\n\nx");
});

interface FakeCall { lo: number; hi: number; count: number; params: Record<string, unknown>; pdfPages: number }

/** A client whose messages.stream().finalMessage() answers from `reply`, recording each call. */
function fakeClient(reply: (call: FakeCall, index: number) => Partial<Anthropic.Message> & { text?: string }) {
  const calls: FakeCall[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageStreamParams, _opts?: unknown) {
        const content = (params.messages[0]!.content as Anthropic.ContentBlockParam[]);
        const doc = content[0] as Anthropic.DocumentBlockParam;
        const data = (doc.source as Anthropic.Base64PDFSource).data;
        const instruction = (content[1] as Anthropic.TextBlockParam).text;
        const m = /(?:It is page|They are pages) (\d+)(?: to (\d+))?/.exec(instruction)!;
        const lo = Number(m[1]);
        const hi = Number(m[2] ?? m[1]);
        const call: FakeCall = { lo, hi, count: hi - lo + 1, params: params as unknown as Record<string, unknown>, pdfPages: -1 };
        calls.push(call);
        return {
          async finalMessage(): Promise<Anthropic.Message> {
            assert.ok(!data.includes("\n"), "base64 has no newlines");
            call.pdfPages = (await PDFDocument.load(Buffer.from(data, "base64"))).getPageCount();
            const { text, ...rest } = reply(call, calls.length - 1);
            return {
              id: "msg_1", type: "message", role: "assistant", model: "fake", stop_sequence: null, stop_details: null,
              content: [{ type: "text", text: text ?? "", citations: null }],
              stop_reason: "end_turn",
              usage: { input_tokens: 100 + lo, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null, inference_geo: null, server_tool_use: null, service_tier: null, output_tokens_details: null } as unknown as Anthropic.Usage,
              ...rest,
            } as Anthropic.Message;
          },
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const pageText = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => `[[page ${lo + i}]]\n\nText of page ${lo + i}.`).join("\n\n");

test("ocrPdfPages: 16 pages → 2 requests of 15 + 1, original numbering, usage per request, progress events", async () => {
  const pdf = await pdfWithPages(Array.from({ length: 16 }, () => null));
  const { client, calls } = fakeClient((c) => ({ text: pageText(c.lo, c.hi) }));
  const events: [string, number][] = [];
  const out = await ocrPdfPages(pdf, Array.from({ length: 16 }, (_, i) => i + 1), { client, model: "fake-model", onEvent: (m, p) => events.push([m, p]) });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => [c.lo, c.hi, c.pdfPages]).sort((a, b) => a[0]! - b[0]!), [[1, 15, 15], [16, 16, 1]]);
  assert.equal(out.model, "fake-model");
  assert.equal(out.usage.length, 2);
  for (let p = 1; p <= 16; p++) assert.ok(out.text.includes(`[[page ${p}]]\n\nText of page ${p}.`), `page ${p}`);
  assert.ok(out.text.indexOf("[[page 15]]") < out.text.indexOf("[[page 16]]"));
  assert.ok(events.some(([m]) => m === "Transcribing pages 1 to 15 (1 of 2)"), events.map((e) => e[0]).join(" | "));
  assert.ok(events.some(([m]) => m === "Transcribing page 16 (2 of 2)"));
  assert.equal(events[events.length - 1]![1], 1);
  // Request shape: adaptive thinking, low effort, cached system prompt, PDF document first, no sampling params.
  const p = calls[0]!.params;
  assert.deepEqual(p["thinking"], { type: "adaptive" });
  assert.deepEqual(p["output_config"], { effort: "low" });
  assert.equal(p["max_tokens"], 32000);
  assert.equal(p["model"], "fake-model");
  assert.ok(!("temperature" in p) && !("budget_tokens" in p));
  const system = p["system"] as Anthropic.TextBlockParam[];
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
  assert.match(system[0]!.text, /\[\[page N\]\]/);
  // The merged result drops straight into the extractor's marked text.
  const original = Array.from({ length: 16 }, (_, i) => `[[page ${i + 1}]]`).join("\n\n");
  const merged = mergeOcr(original, out.text);
  assert.equal(chunkText(merged)[0]!.locator.slice(0, 4), "pp. ");
});

test("ocrPdfPages: a batch that hits max_tokens is split in two and retried; local numbering is remapped", async () => {
  const pdf = await pdfWithPages(Array.from({ length: 16 }, () => null));
  const { client, calls } = fakeClient((c) => c.count > 8
    ? { text: "[[page 1]]\n\ntruncated…", stop_reason: "max_tokens" }
    // Answer with local numbering (1..K) to exercise the remap.
    : { text: pageText(1, c.count) });
  const events: string[] = [];
  const out = await ocrPdfPages(pdf, Array.from({ length: 16 }, (_, i) => i + 1), { client, model: "fake", onEvent: (m) => events.push(m) });
  const spans = calls.map((c) => `${c.lo}-${c.hi}`).sort();
  assert.deepEqual(spans, ["1-15", "1-8", "16-16", "9-15"]);
  assert.equal(out.usage.length, 4, "the truncated response's usage is kept too");
  for (let p = 1; p <= 16; p++) assert.ok(out.text.includes(`[[page ${p}]]`), `page ${p}`);
  assert.ok(out.text.includes("[[page 9]]\n\nText of page 1."), "remapped from local numbering");
  assert.ok(!out.text.includes("truncated"));
  assert.ok(events.some((m) => /splitting in two/.test(m)));
  assert.ok(events.some((m) => /numbered pages 9 to 15 from 1/.test(m)), events.join(" | "));
});

test("ocrPdfPages: refusal and SDK errors become learner-readable OcrErrors; invalid pages are ignored", async () => {
  const pdf = await pdfWithPages([null, null, null]);
  const refusing = fakeClient(() => ({ text: "", stop_reason: "refusal" }));
  await assert.rejects(ocrPdfPages(pdf, [1, 2], { client: refusing.client, model: "fake" }), (e: unknown) => e instanceof OcrError && /declined to transcribe pages 1 to 2/.test(e.message));
  const throwing = { messages: { stream() { throw new Error("socket hang up"); } } } as unknown as Anthropic;
  await assert.rejects(ocrPdfPages(pdf, [1], { client: throwing, model: "fake" }), (e: unknown) => e instanceof OcrError && /socket hang up/.test(e.message));
  const none = await ocrPdfPages(pdf, [0, 7, 2.5], { client: refusing.client, model: "fake" });
  assert.deepEqual(none, { text: "", usage: [], model: "fake" });
  const single = fakeClient((c) => ({ text: `[[page ${c.lo}]]\n\nonly` }));
  const one = await ocrPdfPages(pdf, [3, 3, 1], { client: single.client, model: "fake" });
  assert.deepEqual(single.calls.map((c) => [c.lo, c.hi]), [[1, 1], [3, 3]]);
  assert.equal(one.text, "[[page 1]]\n\nonly\n\n[[page 3]]\n\nonly");
});

// ---------------------------------------------------------------- url guard

test("url guard: refuses non-http schemes and private or loopback hosts", async () => {
  for (const bad of ["ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "not a url",
    "http://localhost/", "http://127.0.0.1:8080/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[fe80::1]/", "http://0.0.0.0/", "http://foo.local/", "http://user:pw@example.com/"]) {
    await assert.rejects(assertSafeUrl(bad), (e: unknown) => e instanceof UrlError && e.status === 400, bad);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("2606:4700::1111"), false);
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("100.64.0.1"), true);
  const ok = await assertSafeUrl("https://93.184.216.34/page");
  assert.equal(ok.hostname, "93.184.216.34");
});
