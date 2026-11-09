import { useRef, useState, type CSSProperties } from "react";
import type { AppState, Source } from "@mastery/shared";
import { Icon } from "@mastery/ui/glass";
import { formatCount, shortAge } from "@mastery/ui";
import { api, watchJob } from "../api";
import { ACCEPT, sizeLabel } from "../components/SourcePicker";

interface Props {
  state: AppState | null;
  heroStyle: CSSProperties;
  reload: () => Promise<void>;
  notify: (text: string, opts?: { error?: boolean }) => void;
  onRead: (sourceId: string, chunk?: number) => void;
  onBuild: (sourceIds: string[]) => void;
}

/** The library is a peer of "Begin session", never a step before it. Reading before attempting is the habit this is built to break. */
export function Library({ state, heroStyle, reload, notify, onRead, onBuild }: Props) {
  const sources = state?.sources ?? [];
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ocring, setOcring] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  async function transcribe(s: Source) {
    setOcring((o) => ({ ...o, [s.id]: "Starting…" }));
    try {
      const job = await api.ocr(s.id);
      const done = await watchJob(job.id, (ev) => setOcring((o) => ({ ...o, [s.id]: ev.message })));
      await reload();
      notify(done.status === "done" ? done.events.at(-1)?.message ?? "Transcribed." : done.error ?? "Transcription failed.", { error: done.status !== "done" });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setOcring((o) => { const n = { ...o }; delete n[s.id]; return n; });
    }
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(formatCount(files.length, { one: "Reading {n} file…", other: "Reading {n} files…" }));
    try {
      const added = await api.upload(files);
      await reload();
      const warned = added.filter((s) => s.warning);
      notify(warned.length ? `Added ${added.length}. ${warned[0]!.warning}` : formatCount(added.length, { one: "Added {n} source", other: "Added {n} sources" }), { error: warned.length > 0 });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(null);
    }
  }
  async function addUrl() {
    if (!url.trim()) return;
    setBusy("Fetching the page…");
    try {
      const s = await api.addUrl(url.trim());
      setUrl("");
      await reload();
      notify(s.warning ? `Added, but: ${s.warning}` : `Added ${s.title}`, { error: Boolean(s.warning) });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(null);
    }
  }
  async function remove(s: Source) {
    if (!window.confirm(`Remove "${s.title}" from the library? Courses built from it keep their items.`)) return;
    try {
      await api.deleteSource(s.id);
      selected.delete(s.id);
      await reload();
      notify(`Removed ${s.title}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    }
  }
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const buildIds = selected.size ? [...selected] : sources.map((s) => s.id);

  return (
    <>
      <section className="hero enter" style={heroStyle}>
        <span className="overline">Library</span>
        <p className="big"><span className="num">{sources.length}</span><span className="unit">{sources.length === 1 ? "source" : "sources"}</span></p>
        <span className="hero-sub">Every source becomes a Markdown page in your data folder, with the original kept beside it. Nothing is sent anywhere until you build a course or grade a session, and reading suggestions only attach to items you missed.</span>
        <div className="hero-ctas">
          <button type="button" className="pill prime" data-tour="build" disabled={!sources.length || !!busy} onClick={() => onBuild(buildIds)}>
            <Icon name="sparkle" small />{selected.size ? `Build a course from ${selected.size}` : "Build a course"}
          </button>
        </div>
      </section>

      <div className="narrow enter">
        <label
          className={`drop${over ? " over" : ""}`}
          data-tour="drop"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]); }}
        >
          <span className="disc ctrl"><Icon name="upload" /></span>
          <strong>{busy ?? "Drop sources here, or click to choose"}</strong>
          <span>PDF, DOCX, PPTX, XLSX, EPUB, Markdown, text or HTML, up to 60 MB each. Text is extracted on your machine into a Markdown page you can open and edit. Scanned PDFs are transcribed with the model on request.</span>
          <input ref={input} type="file" multiple accept={ACCEPT} onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>

        <form className="glass form-stack" onSubmit={(e) => { e.preventDefault(); void addUrl(); }} style={{ padding: "14px 18px" }}>
          <label htmlFor="src-url">Or a web page</label>
          <div className="btn-row" style={{ flexWrap: "nowrap" }}>
            <input id="src-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!busy} />
            <button type="submit" className="cta auto" disabled={!url.trim() || !!busy}>Add</button>
          </div>
        </form>

        <section className="glass" aria-labelledby="sources-title">
          <div className="section-h">
            <h2 id="sources-title">Sources</h2>
            {selected.size > 0 && <button type="button" className="link" onClick={() => setSelected(new Set())}>Clear selection</button>}
          </div>
          {!sources.length ? (
            <div className="empty"><strong>Empty</strong><span>Your first source becomes your first course.</span></div>
          ) : (
            <ul className="rows">
              {sources.map((s) => (
                <li key={s.id} className={`row static${selected.has(s.id) ? " sel" : ""}`}>
                  <input type="checkbox" className="check" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.title}`} />
                  <span className="kind">{s.kind}</span>
                  <button type="button" className="link-like row-main" onClick={() => onRead(s.id)}>
                    <span className="row-title">{s.title}</span>
                    <span className="row-sub">
                      {sizeLabel(s)} · {shortAge(s.added)} ago{s.method === "ocr" ? " · transcribed" : s.method === "mixed" ? " · partly transcribed" : ""}{s.edited ? " · edited" : ""}
                      {s.warning ? ` · ${s.warning}` : ""}
                    </span>
                  </button>
                  {s.needsOcr?.length ? (
                    <button type="button" className="cta ghost auto small" disabled={!!ocring[s.id] || state?.key.mode === "none"} title={state?.key.mode === "none" ? "Add an API key in Settings first" : undefined} onClick={() => void transcribe(s)}>
                      {ocring[s.id] ?? `Transcribe ${s.needsOcr.length} pages`}
                    </button>
                  ) : null}
                  <button type="button" className="ibtn ctrl" aria-label={`Remove ${s.title}`} onClick={() => void remove(s)}><Icon name="trash" small /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
