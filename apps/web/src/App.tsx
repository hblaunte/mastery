import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, SessionRecord } from "@mastery/shared";
import { Icon, Sheet, TabBar, Toast, heroStyle, useSheet, useTheme, useToast, type GlassTab } from "@mastery/ui/glass";
import { api } from "./api";
import { Onboarding } from "./onboarding";
import { Home } from "./screens/Home";
import { Study } from "./screens/Study";
import { Library } from "./screens/Library";
import { GraphTab } from "./screens/GraphTab";
import { Progress } from "./screens/Progress";
import { SessionSheet } from "./sheets/Session";
import { ResultsSheet } from "./sheets/Results";
import { SettingsSheet } from "./sheets/Settings";
import { ReaderSheet } from "./sheets/Reader";
import { BuildSheet } from "./sheets/Build";
import { CourseSheet } from "./sheets/Course";

export type TabId = "home" | "study" | "library" | "graph" | "progress";
export const TABS: GlassTab<TabId>[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "study", label: "Study", icon: "study", tour: "tab-study" },
  { id: "library", label: "Library", icon: "book", tour: "tab-library" },
  { id: "graph", label: "Graph", icon: "graph", tour: "tab-graph" },
  { id: "progress", label: "Progress", icon: "chart", tour: "tab-progress" },
];

export type SheetKind =
  | { kind: "session"; courseIds?: string[]; size?: number }
  | { kind: "results"; record: SessionRecord }
  | { kind: "settings" }
  | { kind: "reader"; sourceId: string; chunk?: number }
  | { kind: "build"; sourceIds: string[] }
  | { kind: "course"; id: string };

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("home");
  const [scrollY, setScrollY] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const { sheet, closing, open, close } = useSheet<SheetKind>();
  const { toast, show } = useToast();
  const [theme, setTheme] = useTheme();
  const [tour, setTour] = useState(false);
  const dirty = useRef(false); // a session with answers in it

  const reload = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // First run: the tour opens once state is known and the learner has not finished it before.
  useEffect(() => {
    if (state && !state.settings.onboardingDone && !tour) setTour(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.settings.onboardingDone]);

  function go(t: TabId) {
    scrollRef.current?.scrollTo?.({ top: 0 });
    setScrollY(0);
    setTab(t);
  }
  function onScroll(e: React.UIEvent<HTMLElement>) {
    const y = e.currentTarget.scrollTop;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollY(Math.round(Math.min(y, 400))));
  }
  const requestClose = useCallback(() => {
    if (sheet?.kind === "session" && dirty.current && !window.confirm("Leave this session? Your answers so far will be lost.")) return;
    dirty.current = false;
    close();
  }, [sheet, close]);

  function onGraded(record: SessionRecord) {
    dirty.current = false;
    open({ kind: "results", record });
    void reload();
    const lit = record.responses.filter((r) => r.graph.newlyLit).length;
    show(lit ? `Graded. ${lit === 1 ? "One new node lit" : `${lit} new nodes lit`} on your graph.` : "Graded. Intervals updated.");
  }
  async function finishTour(completed: boolean) {
    setTour(false);
    try {
      await api.settings({ onboardingDone: true });
      await reload();
    } catch { /* the tour simply shows again next time */ }
    if (completed) show("You know how it works. Add your key or drop a source to begin.");
  }

  const hero = heroStyle(scrollY);
  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? "Home";
  const beginSession = (courseIds?: string[], size?: number) => open({ kind: "session", courseIds, size });

  return (
    <div className="shell" data-tab={tab}>
      {TABS.map((t) => <div key={t.id} className={`wash ${t.id}${tab === t.id ? " on" : ""}`} aria-hidden="true" />)}

      <div className={`stage${sheet && !closing ? " receded" : ""}`} inert={sheet ? true : undefined}>
        <header className={`topbar${scrollY > 8 ? " glass-on" : ""}`}>
          <h1 className="brand">Mastery</h1>
          <span className="grow" />
          {state && (
            <span className={`link-pill ${state.key.mode === "none" ? "warn" : state.key.valid === false ? "warn" : "ok"}`}>
              {state.key.mode === "none" ? "No API key" : state.key.valid === false ? "Key rejected" : state.key.mode === "managed" ? "Managed key" : `Your key …${state.key.last4 ?? ""}`}
            </span>
          )}
          <button type="button" className="ibtn ctrl" aria-label="How it works" onClick={() => setTour(true)}><Icon name="info" small /></button>
          <button type="button" className="ibtn ctrl" aria-label="Settings and API key" data-tour="key" onClick={() => open({ kind: "settings" })}><Icon name="key" small /></button>
        </header>

        <main ref={scrollRef} className={`scroll${tab === "graph" ? " nopad" : ""}`} aria-label={tabLabel} onScroll={onScroll}>
          {error && <div className="narrow enter"><p className="form-error" role="alert"><strong>Could not reach the server.</strong> {error}</p></div>}
          {tab === "home" && <Home state={state} heroStyle={hero} onBegin={() => beginSession()} onGo={go} onBuild={(ids) => open({ kind: "build", sourceIds: ids })} onCourse={(id) => open({ kind: "course", id })} onSession={(r) => open({ kind: "results", record: r })} />}
          {tab === "study" && <Study state={state} heroStyle={hero} onBegin={beginSession} onCourse={(id) => open({ kind: "course", id })} onGo={go} />}
          {tab === "library" && <Library state={state} heroStyle={hero} reload={reload} notify={show} onRead={(sourceId, chunk) => open({ kind: "reader", sourceId, chunk })} onBuild={(ids) => open({ kind: "build", sourceIds: ids })} />}
          {tab === "graph" && <GraphTab theme={theme} state={state} onStudy={(courseId) => beginSession([courseId])} />}
          {tab === "progress" && <Progress state={state} heroStyle={hero} onSession={(r) => open({ kind: "results", record: r })} onCourse={(id) => open({ kind: "course", id })} />}
        </main>

        <TabBar tabs={TABS} current={tab} onChange={go} compact={scrollY > 120} />
      </div>

      {sheet && <div className={`scrim${closing ? " out" : ""}`} aria-hidden="true" onClick={requestClose} />}
      {sheet?.kind === "session" && (
        <Sheet labelledBy="session-title" closing={closing} onClose={requestClose} width={820}>
          <SessionSheet courseIds={sheet.courseIds} size={sheet.size} onDirty={() => { dirty.current = true; }} onClose={requestClose} onGraded={onGraded} />
        </Sheet>
      )}
      {sheet?.kind === "results" && (
        <Sheet labelledBy="results-title" closing={closing} onClose={close} width={860}>
          <ResultsSheet record={sheet.record} onClose={close} onAgain={() => beginSession()} onRead={(sourceId, chunk) => open({ kind: "reader", sourceId, chunk })} />
        </Sheet>
      )}
      {sheet?.kind === "settings" && (
        <Sheet labelledBy="settings-title" closing={closing} onClose={close} width={720}>
          <SettingsSheet state={state} theme={theme} onTheme={setTheme} reload={reload} notify={show} onClose={close} onTour={() => { close(); setTimeout(() => setTour(true), 260); }} />
        </Sheet>
      )}
      {sheet?.kind === "reader" && (
        <Sheet labelledBy="reader-title" closing={closing} onClose={close} width={820}>
          <ReaderSheet sourceId={sheet.sourceId} chunk={sheet.chunk} sources={state?.sources ?? []} onClose={close} reload={reload} notify={show} />
        </Sheet>
      )}
      {sheet?.kind === "build" && (
        <Sheet labelledBy="build-title" closing={closing} onClose={close} width={760}>
          <BuildSheet sourceIds={sheet.sourceIds} state={state} reload={reload} notify={show} onClose={close} onOpenCourse={(id) => open({ kind: "course", id })} onBegin={(ids) => beginSession(ids)} />
        </Sheet>
      )}
      {sheet?.kind === "course" && (
        <Sheet labelledBy="course-title" closing={closing} onClose={close} width={860}>
          <CourseSheet id={sheet.id} reload={reload} notify={show} onClose={close} onBegin={(ids) => beginSession(ids)} onRead={(sourceId, chunk) => open({ kind: "reader", sourceId, chunk })} />
        </Sheet>
      )}
      <Toast toast={toast} />
      <Onboarding
        open={tour}
        onClose={(completed) => void finishTour(completed)}
        state={state}
        go={go}
        openSheet={(k) => {
          if (k === "settings") open({ kind: "settings" });
          else if (k === "build") open({ kind: "build", sourceIds: state?.sources.map((s) => s.id) ?? [] });
          else { go("library"); setTimeout(() => document.querySelector<HTMLElement>("[data-tour='drop'] input")?.click(), 400); }
        }}
      />
    </div>
  );
}
