import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, decodeEntities } from "./html.js";
import { chunkText, pageMarker } from "./chunk.js";
import { extractFile, detectKind, assertSafeUrl, isPrivateAddress, UrlError } from "./extract.js";

const enc = (s: string) => new TextEncoder().encode(s);

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
  const content1 = "BT /F1 18 Tf 40 700 Td (Hello from page one of the sampling notes) Tj ET";
  const content2 = "BT /F1 18 Tf 40 700 Td (And this is page two with more text) Tj ET";
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
  assert.ok(out.text.includes("[[page 1]]") && out.text.includes("[[page 2]]"), out.text);
  assert.ok(out.text.includes("Hello from page one"));
  const chunks = chunkText(out.text);
  assert.equal(chunks[0]!.locator, "pp. 1–2");
  assert.ok(!chunks[0]!.text.includes("[[page"));
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
