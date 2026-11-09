import type { GradedItem, SessionRecord } from "@mastery/shared";
import { CloseButton, Icon } from "@mastery/ui/glass";
import { Marked } from "../components/Marked";
import { Score, Tip, usageLine } from "../components/bits";

interface Props {
  record: SessionRecord;
  onClose: () => void;
  onAgain: () => void;
  onRead: (sourceId: string, chunk?: number) => void;
}

export function ResultsSheet({ record, onClose, onAgain, onRead }: Props) {
  const cal = record.calibration;
  const scored = record.responses.filter((r) => r.score !== null);
  const lit = record.responses.filter((r) => r.graph.newlyLit).length;
  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} /></div>
      <h2 className="sheet-title" id="results-title">Session complete</h2>
      <div className="stats">
        <div className="stat"><b>{cal.meanScore ?? "—"}</b><span>mean score</span></div>
        <div className="stat"><b>{cal.bias != null ? `${cal.bias > 0 ? "+" : ""}${Math.round(cal.bias)}` : "—"}</b><span><Tip label="calibration bias" text="Mean predicted confidence minus mean score. Positive means you were overconfident, negative means you under-rated yourself." /></span></div>
        <div className="stat"><b>{cal.resolution != null ? cal.resolution.toFixed(2) : "—"}</b><span><Tip label="resolution (r)" text="The correlation between what you predicted and what you scored. Bias with high resolution is easy to fix. Low resolution means your confidence carries no information." /></span></div>
        <div className="stat"><b>{lit}</b><span>{lit === 1 ? "node newly lit" : "nodes newly lit"}</span></div>
      </div>
      {record.usage.calls > 0 && <p className="hint">{usageLine(record.usage)}</p>}

      {cal.report && (
        <section className="glass result" aria-labelledby="cal-title">
          <h3 id="cal-title" style={{ fontSize: 16, fontWeight: 600 }}>Calibration</h3>
          <p className="feedback">{cal.report}</p>
          {cal.recommendations?.length ? <div className="recs">{cal.recommendations.map((r, i) => <div key={i}>{r}</div>)}</div> : null}
        </section>
      )}
      {cal.error && <p className="form-error" role="alert"><strong>Calibration review failed.</strong> {cal.error}</p>}

      <h3 style={{ fontSize: 16, fontWeight: 600, paddingInline: 4 }}>Item by item · {scored.length} graded</h3>
      {record.responses.map((x) => <ResultCard key={x.id} x={x} onRead={onRead} />)}

      <div className="dock">
        <button type="button" className="cta" onClick={onAgain}><Icon name="play" small />Another session</button>
        <button type="button" className="cta ghost" onClick={onClose}>Done</button>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>Saved locally. Intervals updated: what you missed comes back sooner.</p>
    </>
  );
}

function ResultCard({ x, onRead }: { x: GradedItem; onRead: (sourceId: string, chunk?: number) => void }) {
  return (
    <section className="glass result">
      <div className="result-head">
        <div className="chips">
          <span className="chip">{x.type === "mcq" ? "multiple choice" : x.type}</span>
          <span className="chip">{x.topic}</span>
          {x.graph.newlyLit && <span className="newly"><Icon name="sparkle" small />newly lit</span>}
        </div>
        <Score value={x.score} />
      </div>
      <p className="quote" style={{ color: "var(--fg2)" }}>{x.prompt}</p>
      <p className="feedback">{x.feedback}</p>
      {x.response.trim() && x.type !== "mcq" && <><span className="field-label">Your answer, marked</span><Marked text={x.response} quotes={x.quotes} /></>}
      {x.rubricScores.length > 0 && (
        <div className="rubric">
          {x.rubricScores.map((c, i) => <div key={i}><span className={`verdict ${c.verdict}`}>{c.verdict}</span><span>{c.criterion} <span className="muted">· {c.note}</span></span></div>)}
        </div>
      )}
      {x.answerKey && x.type !== "mcq" && <div className="keyblock">{x.answerKey}</div>}
      {x.probe && <div className="keyblock"><b>Follow-up:</b> {x.probe}</div>}
      {x.bridge && <p className="hint">You already know this: {x.bridge}</p>}
      {x.reading.length > 0 && (
        <div className="keyblock read">
          <b>Where to read this up:</b>{" "}
          {x.reading.map((r, i) => (
            <span key={i}>{i > 0 && " · "}<button type="button" className="link" style={{ padding: 0, color: "inherit", textDecoration: "underline" }} onClick={() => onRead(r.sourceId, r.chunk)}>{r.title}, {r.locator}</button></span>
          ))}
        </div>
      )}
      <p className="jolline">predicted <b>{x.jolPre ?? "—"}</b> → felt <b>{x.jolPost ?? "—"}</b> → scored <b>{x.score ?? "—"}</b></p>
    </section>
  );
}
