import { useEffect, useState } from "react";
import type { AppState } from "@mastery/shared";
import { CloseButton, type ThemePref } from "@mastery/ui/glass";
import { api } from "../api";

interface Props {
  state: AppState | null;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  reload: () => Promise<void>;
  notify: (text: string, opts?: { error?: boolean }) => void;
  onClose: () => void;
  onTour: () => void;
}

const THEMES: { id: ThemePref; label: string }[] = [{ id: "system", label: "System" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }];

export function SettingsSheet({ state, theme, onTheme, reload, notify, onClose, onTour }: Props) {
  const key = state?.key;
  const settings = state?.settings;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(settings?.graphThreshold ?? 75);
  const [background, setBackground] = useState(settings?.background ?? "");
  const [prompts, setPrompts] = useState<{ name: string; text: string }[]>([]);
  const [promptName, setPromptName] = useState("_system.md");
  const [promptText, setPromptText] = useState("");

  useEffect(() => { void api.prompts().then((p) => { setPrompts(p); setPromptText(p.find((x) => x.name === promptName)?.text ?? ""); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPromptText(prompts.find((x) => x.name === promptName)?.text ?? ""); }, [promptName, prompts]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); await reload(); notify(done); } catch (e) { notify(e instanceof Error ? e.message : String(e), { error: true }); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} /></div>
      <div className="profile"><h2 id="settings-title">Settings</h2></div>

      <section className="glass" aria-labelledby="key-title">
        <div className="section-h"><h3 id="key-title">API key</h3>
          <span className={`link-pill ${key?.mode === "none" ? "warn" : key?.valid === false ? "warn" : "ok"}`}>
            {key?.mode === "none" ? "Not set" : key?.valid === false ? "Rejected" : key?.mode === "managed" ? "Managed" : `Yours …${key?.last4 ?? ""}`}
          </span>
        </div>
        <div className="pad">
          <p className="lede">Grading and course building call Claude with this key. It is stored encrypted in the data folder and used only for outbound calls from the server. It never reaches the browser.</p>
          {key?.error && <p className="form-error" role="alert">{key.error}</p>}
          <form className="form-stack" style={{ padding: 0 }} onSubmit={(e) => { e.preventDefault(); void run(() => api.setKey({ mode: "byok", key: draft }).then(() => setDraft("")), "Key saved and checked."); }}>
            <label htmlFor="key-input">Your Anthropic API key</label>
            <div className="btn-row" style={{ flexWrap: "nowrap" }}>
              <input id="key-input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="cta auto" disabled={busy || draft.trim().length < 20}>{key?.mode === "byok" ? "Replace" : "Save"}</button>
            </div>
            <p className="field-hint">Get one at console.anthropic.com. You pay Anthropic directly for what you use; every session shows its cost.</p>
          </form>
          <div className="btn-row">
            {key?.managedAvailable && key.mode !== "managed" && (
              <button type="button" className="cta ghost auto small" disabled={busy} onClick={() => void run(() => api.setKey({ mode: "managed" }), "Using the managed key.")}>Use the managed key</button>
            )}
            {key?.mode !== "none" && <button type="button" className="cta ghost auto small" disabled={busy} onClick={() => void run(() => api.validateKey(), "Key checked.")}>Check key</button>}
            {key?.mode !== "none" && <button type="button" className="cta ghost auto small" disabled={busy} onClick={() => void run(() => api.setKey({ mode: "none" }), "Key removed.")}>Remove</button>}
          </div>
          {!key?.managedAvailable && <p className="hint">A managed key (pay us, we hold the key) appears here when the server is started with MASTERY_MANAGED_KEY set.</p>}
        </div>
      </section>

      <section className="glass settings-row" aria-labelledby="appearance-title">
        <span id="appearance-title" className="row-title">Appearance</span>
        <div className="seg" role="group" aria-labelledby="appearance-title">
          {THEMES.map((t) => <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => onTheme(t.id)}>{t.label}</button>)}
        </div>
      </section>

      <section className="glass" aria-labelledby="graph-title">
        <div className="section-h"><h3 id="graph-title">Knowledge graph threshold</h3><span className="chip">{threshold}</span></div>
        <div className="pad">
          <p className="lede">An item joins the graph once its latest score reaches this. 75 is the boundary of "substantively correct" in the grading anchors and the same cutoff below which a reading suggestion attaches: below it you get reading, at or above it you get a node. Multiple choice never fully lights a node on its own.</p>
          <input type="range" min={50} max={95} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Graph threshold" style={{ width: "100%", accentColor: "var(--ink)" }} />
          <div className="btn-row">
            <button type="button" className="cta auto small" disabled={busy || threshold === settings?.graphThreshold} onClick={() => void run(() => api.settings({ graphThreshold: threshold }), "Threshold saved. The graph recomputes on next view.")}>Save</button>
            <span className="hint">Lower is more forgiving; 90 means only near-perfect answers count.</span>
          </div>
        </div>
      </section>

      <section className="glass" aria-labelledby="bg-title">
        <div className="section-h"><h3 id="bg-title">Your background</h3></div>
        <div className="pad">
          <p className="lede">What you already know, in a few lines. The course builder uses it to write bridges from new material to things you know, and the grader credits correct reasoning in your own vocabulary.</p>
          <textarea className="input" rows={4} value={background} onChange={(e) => setBackground(e.target.value)} placeholder="For example: trained in statistics and research design; comfortable with regression; no formal machine learning." />
          <div className="btn-row"><button type="button" className="cta auto small" disabled={busy || background === settings?.background} onClick={() => void run(() => api.settings({ background }), "Background saved.")}>Save</button></div>
        </div>
      </section>

      <section className="glass" aria-labelledby="routes-title">
        <div className="section-h"><h3 id="routes-title">Grading routes</h3></div>
        <dl className="dl">
          {Object.entries(settings?.routing ?? {}).map(([job, r]) => <><dt key={`${job}-t`}>{job}</dt><dd key={`${job}-d`} className="path">{r}</dd></>)}
        </dl>
        <p className="hint" style={{ padding: "0 18px 16px" }}>Set per job with environment variables; see .env.example. Multiple choice never leaves this machine.</p>
      </section>

      <section className="glass" aria-labelledby="prompts-title">
        <div className="section-h"><h3 id="prompts-title">Prompts</h3></div>
        <div className="pad">
          <p className="lede">The grading and course-building prompts are plain Markdown, re-read on every request. If the grader is too soft or too harsh, edit them here rather than working around them.</p>
          <div className="form-stack" style={{ padding: 0 }}>
            <select value={promptName} onChange={(e) => setPromptName(e.target.value)} aria-label="Prompt file">
              {prompts.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <textarea className="input" rows={12} value={promptText} onChange={(e) => setPromptText(e.target.value)} spellCheck={false} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }} />
            <div className="btn-row">
              <button type="button" className="cta auto small" disabled={busy || promptText === prompts.find((p) => p.name === promptName)?.text} onClick={() => void run(async () => { await api.savePrompt(promptName, promptText); setPrompts(await api.prompts()); }, `Saved ${promptName}. Live on the next request.`)}>Save prompt</button>
            </div>
          </div>
        </div>
      </section>

      <section className="glass settings-row">
        <span className="row-title">How it works</span>
        <button type="button" className="cta ghost auto small" onClick={onTour}>Replay the tour</button>
      </section>
    </>
  );
}
