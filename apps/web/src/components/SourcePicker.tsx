import { useRef, useState } from "react";
import type { Source } from "@mastery/shared";
import { Icon } from "@mastery/ui/glass";
import { formatCount } from "@mastery/ui";
import { api } from "../api";
import { useT, type T } from "../i18n";

interface Props {
  sources: Source[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Called after an upload or URL add so the caller can refresh app state. New ids are pre-selected. */
  onAdded: (added: Source[]) => Promise<void> | void;
  notify: (text: string, opts?: { error?: boolean }) => void;
  disabled?: boolean;
}

export const ACCEPT = ".pdf,.md,.markdown,.txt,.html,.htm,.docx,.pptx,.xlsx,.epub,application/pdf,text/markdown,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/epub+zip";

export function sizeLabel(s: Source, t: T, locale: string): string {
  const k = Math.round(s.chars / 1000);
  const pages = s.pages ? `${s.kind === "pptx" ? t("{n} slides", { n: s.pages }) : t("{n} pages", { n: s.pages })} · ` : "";
  return `${pages}${t("{k}k chars", { k: k.toLocaleString(locale) })} · ${formatCount(s.chunks, { one: t("{n} passage"), other: t("{n} passages") }, locale)}`;
}

/**
 * Tick the sources a course is built from, and add new ones without leaving the sheet. Used by the
 * Build sheet; the Library tab has its own fuller list with reading and removal.
 */
export function SourcePicker({ sources, selected, onChange, onAdded, notify, disabled }: Props) {
  const { t, locale } = useT();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(formatCount(files.length, { one: t("Reading {n} file…"), other: t("Reading {n} files…") }, locale));
    try {
      const added = await api.upload(files);
      onChange(new Set([...selected, ...added.map((s) => s.id)]));
      await onAdded(added);
      const warned = added.filter((s) => s.warning);
      notify(warned.length ? `${t("Added {n}.", { n: added.length })} ${warned[0]!.warning}` : formatCount(added.length, { one: t("Added {n} source"), other: t("Added {n} sources") }, locale), { error: warned.length > 0 });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(null);
    }
  }
  async function addUrl() {
    if (!url.trim()) return;
    setBusy(t("Fetching the page…"));
    try {
      const s = await api.addUrl(url.trim());
      setUrl("");
      onChange(new Set([...selected, s.id]));
      await onAdded([s]);
      notify(s.warning ? t("Added, but: {warning}", { warning: s.warning }) : t("Added {title}", { title: s.title }), { error: Boolean(s.warning) });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(null);
    }
  }
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); onChange(n); };
  const all = sources.length > 0 && sources.every((s) => selected.has(s.id));

  return (
    <div className="picker-wrap">
      {sources.length > 0 && (
        <div className="split-head">
          <span className="field-label" style={{ marginBlockStart: 0 }}>{t("{n} of {total} selected", { n: selected.size, total: sources.length })}</span>
          <button type="button" className="link" disabled={disabled} onClick={() => onChange(all ? new Set() : new Set(sources.map((s) => s.id)))}>{all ? t("Select none") : t("Select all")}</button>
        </div>
      )}
      <ul className="rows src-list">
        {sources.map((s) => {
          const on = selected.has(s.id);
          const unusable = s.chunks === 0;
          return (
            <li key={s.id}>
              <label className={`row src-row${on ? " sel" : ""}${unusable ? " off" : ""}`}>
                <input type="checkbox" className="check" checked={on} disabled={disabled || unusable} onChange={() => toggle(s.id)} />
                <span className="kind">{s.kind}</span>
                <span className="row-main">
                  <span className="row-title">{s.title}</span>
                  <span className="row-sub">{unusable ? s.warning ?? t("No text extracted") : sizeLabel(s, t, locale)}{s.needsOcr?.length ? ` · ${t("{n} scanned pages not yet transcribed", { n: s.needsOcr.length })}` : ""}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <label
        className={`drop small${over ? " over" : ""}${disabled ? " off" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) void addFiles([...e.dataTransfer.files]); }}
      >
        <span className="disc ctrl"><Icon name="upload" /></span>
        <strong>{busy ?? t("Add more sources")}</strong>
        <span>{t("Drop files here or click to choose. PDF, DOCX, PPTX, XLSX, EPUB, Markdown, text or HTML. New files are ticked for this course.")}</span>
        <input ref={input} type="file" multiple accept={ACCEPT} disabled={disabled} onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </label>
      <div className="btn-row" style={{ flexWrap: "nowrap" }}>
        <input type="url" inputMode="url" className="input" placeholder={t("Or paste a web page address")} value={url} onChange={(e) => setUrl(e.target.value)} disabled={disabled || !!busy} aria-label={t("Web page address")} />
        <button type="button" className="cta ghost auto" disabled={disabled || !url.trim() || !!busy} onClick={() => void addUrl()}>{t("Add page")}</button>
      </div>
    </div>
  );
}
