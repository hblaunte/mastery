/**
 * Transcribe scanned PDF pages with Claude's native PDF input.
 *
 * The requested pages are grouped into contiguous runs and cut into batches of at most
 * BATCH_PAGES. Each batch is copied into a fresh PDF with pdf-lib and sent as one streamed
 * request; the model is told the mapping from the batch's page numbers to the original's and
 * asked to write a "[[page N]]" line before each page, in original numbering. Batches run
 * CONCURRENCY at a time. A batch that hits max_tokens is split in two and retried, down to a
 * single page. Every response's usage is collected so the lead can bill it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";

export const BATCH_PAGES = 15;
export const CONCURRENCY = 2;
export const OCR_MAX_TOKENS = 32000;

export interface OcrDeps {
  client: Anthropic;
  model: string;
  onEvent?(message: string, progress: number): void;
  signal?: AbortSignal;
}

export interface OcrResult {
  /** Markdown with [[page N]] markers for exactly the pages transcribed. */
  text: string;
  usage: Anthropic.Usage[];
  model: string;
}

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

export const OCR_SYSTEM = `You transcribe scanned document pages into Markdown for a learner who will study them. The pages arrive as a PDF; the instruction tells you which page numbers of the original document they are.

Rules:
- Transcribe faithfully and completely. Do not summarise, paraphrase, reorder or omit anything, and add no commentary, preamble or closing remarks.
- Keep headings as Markdown headings: "#" for the chapter or page title level, "##" and "###" for subsections, matching the visual hierarchy.
- Keep paragraphs as paragraphs, lists as Markdown lists, and tables as Markdown tables (a header row, a "| --- |" separator row, then one row per table row).
- Write equations and mathematical notation in LaTeX between $ signs ($...$ inline, $$...$$ on its own line).
- Mark every page boundary with a line containing only [[page N]], where N is the ORIGINAL page number given in the instruction. Write the marker before the first line of each page, including the first page. Use the mapping the instruction gives you exactly.
- Where a word or passage cannot be read, write [illegible] rather than guessing.
- Reproduce footnotes, captions, marginal notes and running headers only if they carry content; drop page numbers printed on the page and decorative elements.
- If a page is blank or holds only an image with no text, write the page marker followed by a line saying [no text on this page].
- Output only the transcription. Do not wrap it in a code fence.`;

const MARKER_LINE = /^[ \t]*\[\[page (\d+)\]\][ \t]*$/;

/** Collapse to unique, valid, ascending page numbers. */
function normalisePages(pages: number[], max: number): number[] {
  return [...new Set(pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= max))].sort((a, b) => a - b);
}

/** Contiguous runs, each cut into batches of at most `size`. */
export function batchPages(pages: number[], size = BATCH_PAGES): number[][] {
  const out: number[][] = [];
  let run: number[] = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += size) out.push(run.slice(i, i + size));
    run = [];
  };
  for (const p of pages) {
    if (run.length && p !== run[run.length - 1]! + 1) flush();
    run.push(p);
  }
  flush();
  return out;
}

function describe(batch: number[]): string {
  const lo = batch[0]!;
  const hi = batch[batch.length - 1]!;
  return lo === hi ? `page ${lo}` : `pages ${lo} to ${hi}`;
}

function instructionFor(batch: number[]): string {
  const lo = batch[0]!;
  const hi = batch[batch.length - 1]!;
  const mapping = batch.map((p, i) => `this document's page ${i + 1} is the original's page ${p}`);
  const shown = mapping.length <= 4 ? mapping.join("; ") : `${mapping.slice(0, 2).join("; ")}; … ; ${mapping[mapping.length - 1]}`;
  return `Transcribe ${batch.length === 1 ? "the page" : `all ${batch.length} pages`} of this PDF to Markdown. ${batch.length === 1 ? `It is page ${lo} of the original document` : `They are pages ${lo} to ${hi} of the original document, in order`} (${shown}). Begin each page with a line [[page N]] using the original page numbers: ${batch.map((p) => `[[page ${p}]]`).join(", ")}.`;
}

/** Split `text` into { page → body } by [[page N]] lines; text before the first marker goes to `lead`. */
export function splitPages(text: string): { lead: string; pages: Map<number, string>; order: number[] } {
  const pages = new Map<number, string>();
  const order: number[] = [];
  let lead = "";
  let cur: number | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (cur === null) lead = body;
    else {
      const prev = pages.get(cur);
      pages.set(cur, prev ? `${prev}\n\n${body}`.trim() : body);
    }
    buf = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = MARKER_LINE.exec(line);
    if (m) {
      flush();
      cur = Number(m[1]);
      if (!order.includes(cur)) order.push(cur);
      continue;
    }
    buf.push(line);
  }
  flush();
  return { lead, pages, order };
}

/** Serialise page bodies back to marked text. */
function joinPages(pages: Map<number, string>, order: number[]): string {
  return order.map((n) => {
    const body = (pages.get(n) ?? "").trim();
    return body ? `[[page ${n}]]\n\n${body}` : `[[page ${n}]]`;
  }).join("\n\n");
}

/** Strip a code fence the model may have wrapped the whole output in. */
function unfence(text: string): string {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1]! : text;
}

/**
 * Normalise one batch's transcription so it carries exactly one marker per page of the batch,
 * in original numbering. Returns warnings for anything that had to be guessed.
 */
export function normaliseBatch(raw: string, batch: number[]): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const { lead, pages, order } = splitPages(unfence(raw));
  const wanted = new Set(batch);

  // The model numbered the batch locally (1..K) instead of using the original numbers: remap.
  const usedLocal = order.length > 0 && order.every((n) => n >= 1 && n <= batch.length) && !order.every((n) => wanted.has(n));
  if (usedLocal && batch[0] !== 1) {
    const remapped = new Map<number, string>();
    for (const [n, body] of pages) remapped.set(batch[n - 1]!, body);
    pages.clear();
    for (const [n, body] of remapped) pages.set(n, body);
    order.splice(0, order.length, ...order.map((n) => batch[n - 1]!));
    warnings.push(`The model numbered ${describe(batch)} from 1; the numbers were mapped back to the original.`);
  }

  // Markers outside the batch: fold their text into the nearest preceding page of the batch.
  const out = new Map<number, string>();
  let lastInBatch: number | null = null;
  for (const n of order) {
    const body = pages.get(n) ?? "";
    if (wanted.has(n)) {
      lastInBatch = n;
      out.set(n, out.has(n) ? `${out.get(n)}\n\n${body}`.trim() : body);
    } else {
      const target = lastInBatch ?? batch[0]!;
      out.set(target, [out.get(target) ?? "", body].filter(Boolean).join("\n\n").trim());
      warnings.push(`The model wrote a marker for page ${n}, which was not requested; its text was kept under page ${target}.`);
    }
  }
  // Missing markers: the page is inserted at its place, empty unless unmarked lead text fills it.
  const missing = batch.filter((p) => !out.has(p));
  for (const p of missing) out.set(p, "");
  if (missing.length) warnings.push(`No page marker came back for ${describe(missing)}; ${missing.length === 1 ? "its" : "their"} text may be attached to a neighbouring page.`);
  // Text before the first marker belongs to the first page of the batch.
  if (lead) out.set(batch[0]!, [lead, out.get(batch[0]!) ?? ""].filter(Boolean).join("\n\n").trim());

  return { text: joinPages(out, batch), warnings };
}

function translateError(err: unknown, batch: number[], signal?: AbortSignal): Error {
  if (err instanceof OcrError) return err;
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) return new OcrError("Transcription was cancelled.");
  if (err instanceof Anthropic.AuthenticationError) return new OcrError("Anthropic rejected the API key. Check it in Settings.");
  if (err instanceof Anthropic.PermissionDeniedError) return new OcrError("This key is not allowed to use the model. Check it in Settings.");
  if (err instanceof Anthropic.RateLimitError) return new OcrError("Rate limited by the API. Wait a minute and try Transcribe again.");
  if (err instanceof Anthropic.APIConnectionError) return new OcrError("Could not reach the Anthropic API. Check the connection and try again.");
  if (err instanceof Anthropic.BadRequestError) return new OcrError(`The API refused the request for ${describe(batch)} (${err.message}). The pages may be too large to send.`);
  if (err instanceof Anthropic.APIError) return new OcrError(`Anthropic API error ${err.status ?? ""} while transcribing ${describe(batch)}: ${err.message}`.replace(/\s+/g, " "));
  if (err instanceof Error) return new OcrError(`Could not transcribe ${describe(batch)}: ${err.message}`);
  return new OcrError(`Could not transcribe ${describe(batch)}.`);
}

async function subPdf(src: PDFDocument, batch: number[]): Promise<string> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, batch.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  const bytes = await out.save({ useObjectStreams: false });
  return Buffer.from(bytes).toString("base64");
}

/** Transcribe the given 1-based pages of a PDF with Claude's native PDF input. */
export async function ocrPdfPages(pdf: Uint8Array, pages: number[], deps: OcrDeps): Promise<OcrResult> {
  const { client, model, signal } = deps;
  const emit = (message: string, progress: number) => deps.onEvent?.(message, Math.max(0, Math.min(1, progress)));

  let src: PDFDocument;
  try {
    src = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw new OcrError(`Could not open the PDF to transcribe it (${err instanceof Error ? err.message : String(err)}).`);
  }
  const wanted = normalisePages(pages, src.getPageCount());
  if (!wanted.length) return { text: "", usage: [], model };

  const batches = batchPages(wanted);
  const usage: Anthropic.Usage[] = [];
  const results: string[] = new Array<string>(batches.length).fill("");
  let done = 0;

  async function transcribe(batch: number[]): Promise<string> {
    if (signal?.aborted) throw new OcrError("Transcription was cancelled.");
    const data = await subPdf(src, batch);
    let message: Anthropic.Message;
    try {
      message = await client.messages.stream({
        model,
        max_tokens: OCR_MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: OCR_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
            { type: "text", text: instructionFor(batch) },
          ],
        }],
      }, { signal }).finalMessage();
    } catch (err) {
      throw translateError(err, batch, signal);
    }
    if (message.usage) usage.push(message.usage);

    if (message.stop_reason === "refusal") {
      const why = message.stop_details && "explanation" in message.stop_details ? message.stop_details.explanation : undefined;
      throw new OcrError(`The model declined to transcribe ${describe(batch)}${why ? ` (${why})` : ""}. Remove those pages and try again.`);
    }
    if (message.stop_reason === "max_tokens" && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      emit(`${describe(batch)} did not fit in one reply; splitting in two`, done / batches.length);
      const a = await transcribe(batch.slice(0, mid));
      const b = await transcribe(batch.slice(mid));
      return `${a}\n\n${b}`;
    }
    const raw = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    const { text, warnings } = normaliseBatch(raw, batch);
    if (message.stop_reason === "max_tokens") warnings.push(`The transcription of ${describe(batch)} was cut short at the length limit; it may be incomplete.`);
    for (const w of warnings) emit(w, done / batches.length);
    return text;
  }

  let next = 0;
  let failure: Error | undefined;
  const worker = async () => {
    while (next < batches.length && !failure) {
      const i = next++;
      const batch = batches[i]!;
      emit(`Transcribing ${describe(batch)} (${i + 1} of ${batches.length})`, done / batches.length);
      try {
        results[i] = await transcribe(batch);
      } catch (err) {
        failure ??= err instanceof Error ? err : new OcrError(String(err));
        return;
      }
      done += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  if (failure) throw failure;

  emit(`Transcribed ${wanted.length} page${wanted.length === 1 ? "" : "s"}`, 1);
  return { text: results.filter(Boolean).join("\n\n"), usage, model };
}

/**
 * Merge transcribed pages back into text that still has [[page N]] markers: replace each marked
 * page's body with the OCR'd one, keep the others, and slot in OCR'd pages the original lacked
 * a marker for (in page order). Idempotent.
 */
export function mergeOcr(original: string, ocr: string): string {
  const orig = splitPages(original);
  const got = splitPages(ocr);
  if (!got.order.length) return original;

  const order = [...orig.order];
  const bodies = new Map(orig.pages);
  for (const n of got.order) {
    bodies.set(n, got.pages.get(n) ?? "");
    if (!order.includes(n)) {
      const at = order.findIndex((m) => m > n);
      if (at < 0) order.push(n); else order.splice(at, 0, n);
    }
  }
  const body = joinPages(bodies, order);
  return orig.lead ? `${orig.lead}\n\n${body}` : body;
}
