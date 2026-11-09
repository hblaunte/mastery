import { useEffect, useState } from "react";
import type { AppState, BuildCourseRequest, Job, JobEvent } from "@mastery/shared";
import { CloseButton, Icon } from "@mastery/ui/glass";
import { formatCount } from "@mastery/ui";
import { api, watchJob } from "../api";
import { SourcePicker } from "../components/SourcePicker";
import { usageLine } from "../components/bits";

interface Props {
  sourceIds: string[];
  state: AppState | null;
  reload: () => Promise<void>;
  notify: (text: string, opts?: { error?: boolean }) => void;
  onClose: () => void;
  onOpenCourse: (id: string) => void;
  onBegin: (courseIds: string[]) => void;
}

const DEPTHS: { id: BuildCourseRequest["depth"]; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "up to 6 topics, 3 items each" },
  { id: "standard", label: "Standard", hint: "up to 10 topics, 5 items each" },
  { id: "deep", label: "Deep", hint: "up to 16 topics, 8 items each" },
];

/**
 * The course wizard: pick sources with checkboxes (or add new ones right here), choose a depth,
 * watch the build, then go straight into a session.
 */
export function BuildSheet({ sourceIds, state, reload, notify, onClose, onOpenCourse, onBegin }: Props) {
  const sources = state?.sources ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(sourceIds));
  const [title, setTitle] = useState("");
  const [depth, setDepth] = useState<BuildCourseRequest["depth"]>("standard");
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<1 | 2>(sourceIds.length ? 2 : 1);
  const noKey = state?.key.mode === "none";

  // A source removed elsewhere drops out of the selection.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => sources.some((s) => s.id === id))));
  }, [sources]);

  const chosen = sources.filter((s) => selected.has(s.id));
  const chars = chosen.reduce((n, s) => n + s.chars, 0);
  const pendingOcr = chosen.reduce((n, s) => n + (s.needsOcr?.length ?? 0), 0);
  const progress = events.at(-1)?.progress ?? 0;
  // Rough: a build reads the sources once for the outline and once per topic, on the strong tier.
  const roughCost = (chars / 4 / 1e6) * 4 * (depth === "light" ? 2 : depth === "standard" ? 3 : 4) + (depth === "light" ? 0.4 : depth === "standard" ? 0.9 : 1.8);

  async function build() {
    setRunning(true);
    setEvents([]);
    try {
      const started = await api.build({ sourceIds: [...selected], depth, title: title.trim() || undefined });
      const done = await watchJob(started.id, (ev) => setEvents((prev) => [...prev, ev]));
      setJob(done);
      await reload();
      if (done.status === "done") notify("Course built.");
      else notify(done.error ?? "The build failed.", { error: true });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} /></div>
      <h2 className="sheet-title" id="build-title">Build a course</h2>
      <p className="lede">Tick what the course should cover. The builder outlines the topics in the order they depend on each other, then writes items for each with answer keys and rubrics grounded in the text, so every question has a passage behind it.</p>

      {!job && (
        <>
          <div className="seg" role="tablist" aria-label="Steps" style={{ justifySelf: "start" }}>
            <button type="button" role="tab" aria-selected={step === 1} aria-pressed={step === 1} onClick={() => setStep(1)} disabled={running}>1 · Sources{selected.size ? ` (${selected.size})` : ""}</button>
            <button type="button" role="tab" aria-selected={step === 2} aria-pressed={step === 2} onClick={() => setStep(2)} disabled={running || selected.size === 0}>2 · Shape and build</button>
          </div>

          {step === 1 && (
            <section className="glass form-stack">
              <SourcePicker sources={sources} selected={selected} onChange={setSelected} onAdded={reload} notify={notify} disabled={running} />
              <div className="dock">
                <button type="button" className="cta" disabled={selected.size === 0} onClick={() => setStep(2)}>
                  Continue with {formatCount(selected.size, { one: "{n} source", other: "{n} sources" })}<Icon name="chevron" small />
                </button>
              </div>
            </section>
          )}

          {step === 2 && (
            <form className="glass form-stack" onSubmit={(e) => { e.preventDefault(); void build(); }}>
              <div className="split-head">
                <span className="field-label" style={{ marginBlockStart: 0 }}>From {formatCount(chosen.length, { one: "{n} source", other: "{n} sources" })} · {Math.round(chars / 1000).toLocaleString()}k characters</span>
                <button type="button" className="link" onClick={() => setStep(1)} disabled={running}>Change</button>
              </div>
              <div className="chips">{chosen.map((s) => <span key={s.id} className="chip">{s.title}</span>)}</div>
              {pendingOcr > 0 && <p className="form-error" role="status"><strong>{formatCount(pendingOcr, { one: "{n} scanned page is", other: "{n} scanned pages are" })} not transcribed yet.</strong> The build will skip them. Transcribe from the Library first if those pages matter.</p>}

              <label htmlFor="build-title-input">Course title (optional)</label>
              <input id="build-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Named from the sources if left blank" disabled={running} />

              <span className="field-label">Depth</span>
              <div className="seg" role="group" aria-label="Depth">
                {DEPTHS.map((d) => <button key={d.id} type="button" aria-pressed={depth === d.id} onClick={() => setDepth(d.id)} disabled={running}>{d.label}</button>)}
              </div>
              <p className="field-hint">{DEPTHS.find((d) => d.id === depth)?.hint}. Rough cost on the strong tier: about ${roughCost.toFixed(2)}. The exact figure is shown when it finishes.</p>
              {state?.settings.background ? <p className="field-hint">Bridges will be written from your background in Settings.</p> : <p className="field-hint">Add your background in Settings and the builder writes bridges from new material to what you already know.</p>}
              {noKey && <p className="form-error" role="alert"><strong>No API key.</strong> Add one in Settings first.</p>}

              {running && (
                <>
                  <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                  <ul className="events" aria-live="polite">{events.slice(-8).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                </>
              )}
              <div className="dock">
                <button type="submit" className="cta" disabled={running || noKey || chosen.length === 0}><Icon name="sparkle" small />{running ? "Building…" : "Build"}</button>
              </div>
            </form>
          )}
        </>
      )}

      {job && (
        <section className="glass" style={{ padding: 20, display: "grid", gap: 12 }}>
          {job.status === "done" && job.courseId ? (
            <>
              <strong style={{ fontSize: 17 }}>{events.at(-1)?.message}</strong>
              <p className="hint">{usageLine(job.usage)}</p>
              <div className="btn-row">
                <button type="button" className="cta auto" onClick={() => onBegin([job.courseId!])}><Icon name="play" small />Begin a session</button>
                <button type="button" className="cta ghost auto" onClick={() => onOpenCourse(job.courseId!)}>Open the course</button>
              </div>
            </>
          ) : (
            <>
              <p className="form-error" role="alert"><strong>The build failed.</strong> {job.error}</p>
              <div className="btn-row"><button type="button" className="cta ghost auto" onClick={() => { setJob(null); setEvents([]); }}>Try again</button></div>
            </>
          )}
        </section>
      )}
    </>
  );
}
