import { useEffect, useRef, useState } from "react";
import type { Source, SourceChunk } from "@mastery/shared";
import { CloseButton, Icon } from "@mastery/ui/glass";
import { api } from "../api";
import { Markdown } from "../components/Markdown";
import { Spinner } from "../components/bits";
import { fmtDate, useT } from "../i18n";

interface Props {
  sourceId: string;
  chunk?: number;
  sources: Source[];
  onClose: () => void;
  reload?: () => Promise<void>;
  notify?: (text: string, opts?: { error?: boolean }) => void;
}

/**
 * The in-app reader. Opened from a reading suggestion it lands on the exact passage; opened from
 * the library it shows the whole Markdown page, which can be edited in place. The page is what the
 * course builder and the grader read, so an edit here changes what they see next.
 */
export function ReaderSheet({ sourceId, chunk, sources, onClose, reload, notify }: Props) {
  const { t, tx, locale } = useT();
  const source = sources.find((s) => s.id === sourceId);
  const [chunks, setChunks] = useState<SourceChunk[] | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [mode, setMode] = useState<"passages" | "page" | "edit">(chunk !== undefined ? "passages" : "page");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hit = useRef<HTMLElement>(null);

  useEffect(() => {
    api.chunks(sourceId).then((r) => setChunks(r.chunks)).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api.markdown(sourceId).then((r) => { setMarkdown(r.markdown); setDraft(r.markdown); }).catch(() => undefined);
  }, [sourceId]);
  useEffect(() => { if (mode === "passages" && chunks && hit.current) hit.current.scrollIntoView({ block: "start" }); }, [chunks, mode]);

  async function save() {
    setSaving(true);
    try {
      await api.saveMarkdown(sourceId, draft);
      setMarkdown(draft);
      setChunks((await api.chunks(sourceId)).chunks);
      await reload?.();
      notify?.(t("Saved. The builder and grader read this version from now on."));
      setMode("page");
    } catch (e) {
      notify?.(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="sheet-bar">
        <CloseButton onClose={onClose} label={t("Close")} />
        <span className="grow" />
        <div className="seg" role="group" aria-label={t("View")}>
          <button type="button" aria-pressed={mode === "page"} onClick={() => setMode("page")}>{t("Page")}</button>
          <button type="button" aria-pressed={mode === "passages"} onClick={() => setMode("passages")}>{t("Passages")}</button>
          <button type="button" aria-pressed={mode === "edit"} onClick={() => { setDraft(markdown ?? ""); setMode("edit"); }} disabled={markdown === null}><Icon name="file" small />{t("Edit")}</button>
        </div>
      </div>
      <h2 className="sheet-title" id="reader-title">{source?.title ?? t("Source")}</h2>
      {source && (
        <p className="lede">
          {source.origin}{source.pages ? ` · ${source.kind === "pptx" ? t("{n} slides", { n: source.pages }) : t("{n} pages", { n: source.pages })}` : ""} · {t("{n} passages", { n: source.chunks })} · {source.method === "ocr" ? t("transcribed by the model") : source.method === "mixed" ? t("partly transcribed") : t("text layer")}
          {source.edited ? ` · ${t("edited {date}", { date: fmtDate(source.edited, locale, {}) })}` : ""}
          {source.needsOcr?.length ? ` · ${t("{n} scanned pages not yet transcribed", { n: source.needsOcr.length })}` : ""}
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {mode === "page" && (markdown === null ? <Spinner label={t("Opening…")} /> : <section className="glass doc-chunk"><Markdown text={markdown} /></section>)}
      {mode === "passages" && (!chunks ? <Spinner label={t("Opening…")} /> : (
        <div className="doc">
          {chunks.map((c) => (
            <section key={c.index} ref={c.index === chunk ? hit : undefined} className={`glass doc-chunk${c.index === chunk ? " hit" : ""}`} aria-label={c.locator}>
              <span className="hint">{c.locator}</span>
              <p>{c.text}</p>
            </section>
          ))}
        </div>
      ))}
      {mode === "edit" && (
        <div className="form-stack glass">
          <p className="field-hint">{tx("Plain Markdown. Lines like {marker} mark where a page starts in the original; keep them if you want reading suggestions to name the right page.", { marker: <code>[[page 12]]</code> })}</p>
          <textarea className="doc-edit" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label={t("Source Markdown")} />
          <div className="btn-row">
            <button type="button" className="cta auto" disabled={saving || draft === markdown} onClick={() => void save()}>{saving ? t("Saving…") : t("Save")}</button>
            <button type="button" className="cta ghost auto" disabled={saving} onClick={() => setMode("page")}>{t("Cancel")}</button>
            <span className="hint">{t("{n} characters", { n: draft.length.toLocaleString(locale) })}</span>
          </div>
        </div>
      )}
    </>
  );
}
