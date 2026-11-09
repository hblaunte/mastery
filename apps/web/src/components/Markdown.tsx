import { Fragment, type ReactNode } from "react";

/**
 * Enough Markdown for extracted sources: headings, paragraphs, lists, quotes, fenced code,
 * tables, rules, inline emphasis and links. Unit markers written by the extractor ("[[page 12]]",
 * "[[slide 3]]") render as small labels so the reader can see where a passage sits in the original.
 * Everything is built as React nodes, so no raw HTML from a document is ever injected.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0, key = 0;
  const k = () => key++;
  const inline = (t: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\(https?:[^)\s]+\))|(\$[^$\n]+\$)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      if (m.index > last) parts.push(t.slice(last, m.index));
      const s = m[0];
      if (s.startsWith("`")) parts.push(<code key={k()}>{s.slice(1, -1)}</code>);
      else if (s.startsWith("**")) parts.push(<strong key={k()}>{s.slice(2, -2)}</strong>);
      else if (s.startsWith("*")) parts.push(<em key={k()}>{s.slice(1, -1)}</em>);
      else if (s.startsWith("$")) parts.push(<code key={k()} className="math">{s.slice(1, -1)}</code>);
      else {
        const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(s)!;
        parts.push(<a key={k()} href={mm[2]} target="_blank" rel="noopener noreferrer">{mm[1]}</a>);
      }
      last = m.index + s.length;
    }
    if (last < t.length) parts.push(t.slice(last));
    return parts;
  };

  while (i < lines.length) {
    const raw = lines[i]!;
    const unit = /^\s*\[\[(page|slide|section)\s+(\d+)\]\]\s*$/.exec(raw);
    if (unit) { out.push(<span key={k()} className="unit">{unit[1]} {unit[2]}</span>); i++; continue; }
    if (/^\s*```/.test(raw)) {
      const buf: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push(<pre key={k()}><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) { const L = h[1]!.length; const Tag = (`h${Math.min(4, L)}`) as "h1" | "h2" | "h3" | "h4"; out.push(<Tag key={k()}>{inline(h[2]!)}</Tag>); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) { out.push(<hr key={k()} />); i++; continue; }
    if (/^\s*>/.test(raw)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={k()}>{inline(buf.join(" "))}</blockquote>);
      continue;
    }
    if (/^\s*\|/.test(raw)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const l = lines[i++]!;
        if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
        rows.push(l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      }
      out.push(
        <table key={k()}>
          <thead>{rows[0] && <tr>{rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>}</thead>
          <tbody>{rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(<li key={k()} style={{ marginInlineStart: Math.min(3, Math.floor(m[1]!.length / 2)) * 16 }}>{inline(m[3]!)}</li>);
        i++;
      }
      out.push(ordered ? <ol key={k()}>{items}</ol> : <ul key={k()}>{items}</ul>);
      continue;
    }
    if (!raw.trim()) { i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*```|\s*>|\s*\||\s*([-*+]|\d+[.)])\s|\s*\[\[(page|slide|section)\s+\d+\]\])/.test(lines[i]!)) buf.push(lines[i++]!);
    out.push(<p key={k()}>{inline(buf.join(" "))}</p>);
  }
  return <div className="md">{out.map((n, j) => <Fragment key={j}>{n}</Fragment>)}</div>;
}
