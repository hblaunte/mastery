/**
 * HTML → plain Markdown-ish text, without a DOM dependency.
 *
 * Scripts, styles and other non-content blocks are removed; h1..h6 become Markdown
 * headings (so the chunker can build heading paths); list items become "- " lines;
 * block elements become paragraph breaks; everything else is unwrapped. Entities are
 * decoded after tags are stripped, so "&lt;script&gt;" in the text stays text.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•",
  middot: "·", copy: "©", reg: "®", trade: "™", deg: "°",
  times: "×", minus: "−", euro: "€", pound: "£", yen: "¥",
  cent: "¢", sect: "§", para: "¶", plusmn: "±", frac12: "½",
  frac14: "¼", frac34: "¾", larr: "←", rarr: "→", uarr: "↑",
  darr: "↓", harr: "↔", le: "≤", ge: "≥", ne: "≠", infin: "∞",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", tau: "τ",
  phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω",
  shy: "", zwj: "", zwnj: "",
};

/** Decode numeric and common named HTML entities in one pass. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : whole;
  });
}

/** Collapse runs of horizontal whitespace, trim lines, limit blank runs to one blank line. */
export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v  -   　]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

const DROP_BLOCKS = ["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "head"];
const BREAK_BEFORE = ["p", "div", "section", "article", "header", "footer", "main", "nav", "aside", "blockquote", "pre", "table", "ul", "ol", "dl", "figure", "hr", "tr", "form", "fieldset", "details", "summary", "address"];
const BREAK_AFTER = ["p", "div", "section", "article", "header", "footer", "main", "nav", "aside", "blockquote", "pre", "table", "ul", "ol", "dl", "figure", "figcaption", "tr", "dd", "dt", "form", "fieldset", "details", "summary", "address", "caption"];

export interface HtmlText {
  /** <title>, else the first h1, else undefined. */
  title?: string;
  text: string;
}

export function htmlToText(html: string): HtmlText {
  let s = html.replace(/<!--[\s\S]*?-->/g, "");

  let title: string | undefined;
  const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s);
  if (t?.[1]) {
    const decoded = collapseWhitespace(decodeEntities(stripTags(t[1]))).replace(/\s+/g, " ");
    if (decoded) title = decoded;
  }

  for (const tag of DROP_BLOCKS) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
  }
  // Unterminated drop blocks (e.g. a <script> with no closer): drop to the end.
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*$/i, "");

  // Headings → Markdown. The inner HTML is unwrapped so "<h2><a>3.2 Sampling</a></h2>" works.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => {
    const text = collapseWhitespace(decodeEntities(stripTags(inner))).replace(/\s+/g, " ");
    if (!text) return "\n\n";
    // Re-encode so the generic entity pass below does not double-decode.
    const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `\n\n${"#".repeat(Number(level))} ${safe}\n\n`;
  });

  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(td|th)\s*>/gi, " \t");
  s = s.replace(new RegExp(`<(${BREAK_BEFORE.join("|")})\\b[^>]*>`, "gi"), "\n\n");
  s = s.replace(new RegExp(`<\\/(${BREAK_AFTER.join("|")})\\s*>`, "gi"), "\n\n");

  s = stripTags(s);
  s = decodeEntities(s);
  s = collapseWhitespace(s);
  // Stray list markers left by empty <li> elements.
  s = s.replace(/^- *$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

  if (!title) {
    const h1 = /^# (.+)$/m.exec(s);
    if (h1?.[1]) title = h1[1].trim();
  }
  return { title, text: s };
}
