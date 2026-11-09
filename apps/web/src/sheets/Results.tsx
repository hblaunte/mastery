import type { GradedItem, ItemType, SessionRecord } from "@mastery/shared";
import { CloseButton, Icon } from "@mastery/ui/glass";
import { Marked } from "../components/Marked";
import { Score, Tip, usageLine } from "../components/bits";
import { signed, useT, type T } from "../i18n";

interface Props {
  record: SessionRecord;
  onClose: () => void;
  onAgain: () => void;
  onRead: (sourceId: string, chunk?: number) => void;
}

/** Full item-type label for chips in the session and the results. */
export function typeLabel(type: ItemType, t: T): string {
  return type === "mcq" ? t("multiple choice") : type === "recall" ? t("recall") : type === "essay" ? t("essay") : t("experiment");
}

export function ResultsSheet({ record, onClose, onAgain, onRead }: Props) {
  const { t, locale } = useT();
  const cal = record.calibration;
  const scored = record.responses.filter((r) => r.score !== null);
  const lit = record.responses.filter((r) => r.graph.newlyLit).length;
  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} label={t("Close")} /></div>
      <h2 className="sheet-title" id="results-title">{t("Session complete")}</h2>
      <div className="stats">
        <div className="stat"><b>{cal.meanScore ?? "—"}</b><span>{t("mean score")}</span></div>
        <div className="stat"><b>{cal.bias != null ? signed(cal.bias) : "—"}</b><span><Tip label={t("calibration bias")} text={t("Mean predicted confidence minus mean score. Positive means you were overconfident, negative means you under-rated yourself.")} /></span></div>
        <div className="stat"><b>{cal.resolution != null ? cal.resolution.toFixed(2) : "—"}</b><span><Tip label={t("resolution (r)")} text={t("The correlation between what you predicted and what you scored. Bias with high resolution is easy to fix. Low resolution means your confidence carries no information.")} /></span></div>
        <div className="stat"><b>{lit}</b><span>{lit === 1 ? t("node newly lit") : t("nodes newly lit")}</span></div>
      </div>
      {record.usage.calls > 0 && <p className="hint">{usageLine(record.usage, t, locale)}</p>}

      {cal.report && (
        <section className="glass result" aria-labelledby="cal-title">
          <h3 id="cal-title" style={{ fontSize: 16, fontWeight: 600 }}>{t("Calibration")}</h3>
          <p className="feedback">{cal.report}</p>
          {cal.recommendations?.length ? <div className="recs">{cal.recommendations.map((r, i) => <div key={i}>{r}</div>)}</div> : null}
        </section>
      )}
      {cal.error && <p className="form-error" role="alert"><strong>{t("Calibration review failed.")}</strong> {cal.error}</p>}

      <h3 style={{ fontSize: 16, fontWeight: 600, paddingInline: 4 }}>{t("Item by item · {n} graded", { n: scored.length })}</h3>
      {record.responses.map((x) => <ResultCard key={x.id} x={x} onRead={onRead} />)}

      <div className="dock">
        <button type="button" className="cta" onClick={onAgain}><Icon name="play" small />{t("Another session")}</button>
        <button type="button" className="cta ghost" onClick={onClose}>{t("Done")}</button>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>{t("Saved locally. Intervals updated: what you missed comes back sooner.")}</p>
    </>
  );
}

function ResultCard({ x, onRead }: { x: GradedItem; onRead: (sourceId: string, chunk?: number) => void }) {
  const { t } = useT();
  const verdict = (v: "met" | "partial" | "absent") => (v === "met" ? t("met") : v === "partial" ? t("partial") : t("absent"));
  return (
    <section className="glass result">
      <div className="result-head">
        <div className="chips">
          <span className="chip">{typeLabel(x.type, t)}</span>
          <span className="chip">{x.topic}</span>
          {x.graph.newlyLit && <span className="newly"><Icon name="sparkle" small />{t("newly lit")}</span>}
        </div>
        <Score value={x.score} />
      </div>
      <p className="quote" style={{ color: "var(--fg2)" }}>{x.prompt}</p>
      <p className="feedback">{x.feedback}</p>
      {x.response.trim() && x.type !== "mcq" && <><span className="field-label">{t("Your answer, marked")}</span><Marked text={x.response} quotes={x.quotes} /></>}
      {x.rubricScores.length > 0 && (
        <div className="rubric">
          {x.rubricScores.map((c, i) => <div key={i}><span className={`verdict ${c.verdict}`}>{verdict(c.verdict)}</span><span>{c.criterion} <span className="muted">· {c.note}</span></span></div>)}
        </div>
      )}
      {x.answerKey && x.type !== "mcq" && <div className="keyblock">{x.answerKey}</div>}
      {x.probe && <div className="keyblock"><b>{t("Follow-up:")}</b> {x.probe}</div>}
      {x.bridge && <p className="hint">{t("You already know this: {bridge}", { bridge: x.bridge })}</p>}
      {x.reading.length > 0 && (
        <div className="keyblock read">
          <b>{t("Where to read this up:")}</b>{" "}
          {x.reading.map((r, i) => (
            <span key={i}>{i > 0 && " · "}<button type="button" className="link" style={{ padding: 0, color: "inherit", textDecoration: "underline" }} onClick={() => onRead(r.sourceId, r.chunk)}>{r.title}, {r.locator}</button></span>
          ))}
        </div>
      )}
      <p className="jolline">{t("predicted")} <b>{x.jolPre ?? "—"}</b> → {t("felt")} <b>{x.jolPost ?? "—"}</b> → {t("scored")} <b>{x.score ?? "—"}</b></p>
    </section>
  );
}
