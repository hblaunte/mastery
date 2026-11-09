import { useEffect, useRef, useState } from "react";
import type { PublicItem, Response, SessionRecord, SessionStart } from "@mastery/shared";
import { CloseButton, Icon, StepTrack } from "@mastery/ui/glass";
import { api } from "../api";
import { ConfidencePicker } from "../components/ConfidencePicker";
import { Spinner } from "../components/bits";
import { useT } from "../i18n";
import { typeLabel } from "./Results";

type Phase = "predict" | "answer" | "reflect";

interface Props {
  courseIds?: string[];
  size?: number;
  onDirty: () => void;
  onClose: () => void;
  onGraded: (record: SessionRecord) => void;
}

/**
 * The session flow is the pedagogy: predict → answer → reflect for each item, then grade
 * everything at once. Nothing is graded, revealed or hinted at until the whole session is in.
 */
export function SessionSheet({ courseIds, size, onDirty, onClose, onGraded }: Props) {
  const { t } = useT();
  const [session, setSession] = useState<SessionStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("predict");
  const [answers, setAnswers] = useState<Record<string, Response>>({});
  const [grading, setGrading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.newSession({ courseIds, size }).then(setSession).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [courseIds, size]);
  useEffect(() => { if (phase === "answer") textarea.current?.focus(); }, [phase, idx]);

  if (error) return <Frame onClose={onClose}><p className="form-error" role="alert">{error}</p></Frame>;
  if (!session) return <Frame onClose={onClose}><Spinner label={t("Building your session…")} /></Frame>;
  if (!session.items.length) {
    return (
      <Frame onClose={onClose}>
        <div className="glass empty"><strong>{t("Nothing to do right now")}</strong><span>{session.message}</span></div>
      </Frame>
    );
  }
  if (grading) {
    return (
      <Frame onClose={() => undefined} hideClose>
        <div className="glass" style={{ padding: 28, display: "grid", gap: 10, justifyItems: "center" }}>
          <Spinner label={t("Marking {n} responses and computing your calibration…", { n: session.items.length })} />
          <p className="hint">{t("Written answers are graded one request each, in parallel, against the passage each item came from. This usually takes under a minute.")}</p>
        </div>
      </Frame>
    );
  }

  const item: PublicItem = session.items[idx]!;
  const a = answers[item.id] ?? { id: item.id, response: "", jolPre: null, jolPost: null };
  const set = (patch: Partial<Response>) => { onDirty(); setAnswers((prev) => ({ ...prev, [item.id]: { ...a, ...patch } })); };
  const last = idx === session.items.length - 1;

  async function advance(skip = false) {
    if (skip) set({ response: "" });
    if (phase === "predict") return setPhase("answer");
    if (phase === "answer") return setPhase("reflect");
    if (!last) { setIdx(idx + 1); setPhase("predict"); return; }
    setGrading(true);
    try {
      const record = await api.submit({ id: session!.id, started: session!.started, responses: session!.items.map((i) => answers[i.id] ?? { id: i.id, response: "", jolPre: null, jolPost: null }) });
      onGraded(record);
    } catch (e) {
      setGrading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Frame onClose={onClose}>
      <StepTrack steps={session.items.map((_, i) => `${i + 1}`)} index={idx} compact label={t("Item {i} of {n}", { i: idx + 1, n: session.items.length })} />
      <section className="glass q-card" aria-live="polite">
        <div className="chips">
          <span className="chip">{typeLabel(item.type, t)}</span>
          <span className="chip">{item.course}</span>
          <span className="chip">{item.topic}</span>
          <span className="chip">{t("difficulty {n}", { n: item.difficulty })}</span>
        </div>
        <p className="q-prompt">{item.prompt}</p>
      </section>

      {phase === "predict" && (
        <section className="glass phase">
          <h3>{t("Before you attempt it: how likely are you to answer this fully correctly?")}</h3>
          <p className="why">{t("Recorded before you see the answer box. The gap between this and your actual score is foresight bias, and it is the most useful number this system produces.")}</p>
          <ConfidencePicker value={a.jolPre} onChange={(v) => set({ jolPre: v })} label={t("Predicted confidence")} />
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button type="button" className="cta auto" disabled={a.jolPre === null} onClick={() => void advance()}>{t("Answer it")}</button>
          </div>
          {a.jolPre === null && <p className="hint" style={{ textAlign: "center" }}>{t("Pick a value to continue.")}</p>}
        </section>
      )}

      {phase === "answer" && (
        <section className="glass phase">
          <h3>{t("Your answer")}</h3>
          {item.type === "mcq" ? (
            <div className="choices" role="radiogroup" aria-label={t("Choices")}>
              {(item.choices ?? []).map((c, i) => (
                <label key={i} className="choice">
                  <input type="radio" name="mcq" value={i} checked={a.response === String(i)} onChange={() => set({ response: String(i) })} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea
              ref={textarea}
              className={`answer${item.type === "experiment" ? " code" : ""}`}
              value={a.response}
              onChange={(e) => set({ response: e.target.value })}
              placeholder={item.type === "experiment" ? t("Paste your code and its actual output, then explain what happened and what it shows.") : t("From memory. No notes, no source. A partly failed retrieval still counts for more than looking it up.")}
            />
          )}
          <div className="btn-row">
            <button type="button" className="cta auto" onClick={() => void advance()}>{t("Done, lock it in")}</button>
            <button type="button" className="cta ghost auto" onClick={() => void advance(true)}>{t("Skip (scores 0)")}</button>
          </div>
        </section>
      )}

      {phase === "reflect" && (
        <section className="glass phase">
          <h3>{t("Now that you have written it: how well do you think you did?")}</h3>
          <p className="why">{t("Asked after the attempt but before the grade. If this drops sharply from your first estimate, the answer felt available and then would not come.")}</p>
          <ConfidencePicker value={a.jolPost} onChange={(v) => set({ jolPost: v })} label={t("Self-assessed performance")} />
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button type="button" className="cta auto" disabled={a.jolPost === null} onClick={() => void advance()}>
              {last ? <><Icon name="check" small />{t("Finish and grade")}</> : t("Next item")}
            </button>
          </div>
        </section>
      )}
    </Frame>
  );
}

function Frame({ children, onClose, hideClose }: { children: React.ReactNode; onClose: () => void; hideClose?: boolean }) {
  const { t } = useT();
  return (
    <div className="session">
      <div className="sheet-bar">{!hideClose && <CloseButton onClose={onClose} label={t("Leave session")} />}<h2 className="sheet-title" id="session-title" style={{ fontSize: 22 }}>{t("Session")}</h2></div>
      {children}
    </div>
  );
}
