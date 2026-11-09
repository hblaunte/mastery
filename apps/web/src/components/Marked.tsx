import type { Quote } from "@mastery/shared";
import { useT } from "../i18n";

/**
 * The learner's answer with the grader's spans highlighted in place. A span that does not appear
 * verbatim is dropped rather than approximated: a highlight over the wrong sentence is worse than
 * no highlight.
 */
export function Marked({ text, quotes }: { text: string; quotes: Quote[] }) {
  const { t } = useT();
  const spans = quotes
    .map((q) => ({ start: text.indexOf(q.text), len: q.text.length, q }))
    .filter((s) => s.start >= 0 && s.q.text.trim())
    .sort((a, b) => a.start - b.start || b.len - a.len);
  const keep: typeof spans = [];
  let last = -1;
  for (const s of spans) if (s.start >= last) { keep.push(s); last = s.start + s.len; }
  if (!keep.length) return <div className="yours">{text}</div>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  keep.forEach((s, i) => {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(<mark key={i} className={`mark ${s.q.kind}`} title={s.q.why}>{text.slice(s.start, s.start + s.len)}</mark>);
    cursor = s.start + s.len;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  const kinds = [...new Set(keep.map((s) => s.q.kind))];
  const legend: Record<string, string> = { good: t("earned the credit"), weak: t("hedged or missing a condition"), wrong: t("would mislead you") };
  return (
    <>
      <div className="yours">{parts}</div>
      <div className="yours-legend">
        {kinds.map((kind) => <span key={kind}><i className={kind} />{legend[kind]}</span>)}
        <span className="hint">{t("hover a highlight for the note")}</span>
      </div>
    </>
  );
}
