import { useEffect, useState, type CSSProperties } from "react";
import type { AppState, SessionRecord } from "@mastery/shared";
import { formatCount } from "@mastery/ui";
import { api } from "../api";
import { Empty, Score, Tip, fmtDate } from "../components/bits";

interface Props {
  state: AppState | null;
  heroStyle: CSSProperties;
  onSession: (r: SessionRecord) => void;
  onCourse: (id: string) => void;
}

const BIAS_TIP = "Mean predicted confidence minus mean score. Positive means you were overconfident; negative means you under-rated yourself and are over-studying things you already know.";
const RES_TIP = "How well your confidence discriminated: the correlation between what you predicted and what you scored. Bias with high resolution is easy to fix. Low resolution means your confidence carries no information, which is the harder problem.";

/** Progress: calibration over time, per-course standing, and every past session. */
export function Progress({ state, heroStyle, onSession, onCourse }: Props) {
  const [history, setHistory] = useState<SessionRecord[]>([]);
  useEffect(() => { void api.history(100).then(setHistory).catch(() => setHistory([])); }, [state?.sessionsDone]);
  const cal = state?.calibration ?? [];
  const last = cal.at(-1);
  const courses = state?.courses ?? [];

  return (
    <>
      <section className="hero enter" style={heroStyle}>
        <span className="overline">Calibration · {formatCount(cal.length, { one: "{n} session", other: "{n} sessions" })}</span>
        <p className="big">
          <span className="num">{last ? `${last.bias > 0 ? "+" : ""}${Math.round(last.bias)}` : "—"}</span>
          <span className="unit"><Tip label="bias" text={BIAS_TIP} /></span>
        </p>
        <span className="hero-sub">
          {last ? (last.bias > 5 ? "You predict more than you produce. Overconfidence is the common case." : last.bias < -5 ? "You produce more than you predict. Underconfidence wastes study time on what you already know." : "Well calibrated on average. Resolution tells you whether the confidence also discriminates.") : "Finish a session to see how well your confidence tracks your knowledge."}
          {last?.resolution != null ? ` Resolution ${last.resolution.toFixed(2)}.` : ""}
        </span>
      </section>

      <div className="content enter">
        <div className="cols">
          <section className="glass" aria-labelledby="trend-title">
            <div className="section-h"><h2 id="trend-title">Bias over sessions</h2><span className="hint"><Tip label="resolution" text={RES_TIP} /> shown as dots</span></div>
            <div className="pad">{cal.length < 2 ? <p className="muted">Two sessions make a line. One makes a point.</p> : <Spark points={cal} />}</div>
          </section>
          <section className="glass" aria-labelledby="standing-title">
            <div className="section-h"><h2 id="standing-title">Courses</h2></div>
            {!courses.length ? <Empty title="No courses yet" /> : (
              <table className="table">
                <thead><tr><th>Course</th><th>Seen</th><th>Lit</th><th>Due</th><th>Mean</th></tr></thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.id}>
                      <td><button type="button" className="link" style={{ padding: 0 }} onClick={() => onCourse(c.id)}>{c.title}</button></td>
                      <td>{c.stats.seen}/{c.itemCount}</td><td>{c.stats.lit}</td><td>{c.stats.due}</td><td>{c.stats.meanScore ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <section className="glass" aria-labelledby="hist-title">
          <div className="section-h"><h2 id="hist-title">Sessions</h2></div>
          {!history.length ? <Empty title="No sessions yet" /> : (
            <ul className="rows">
              {history.map((r) => (
                <li key={r.id}>
                  <button type="button" className="row" onClick={() => onSession(r)}>
                    <Score value={r.calibration.meanScore} />
                    <span className="row-main">
                      <span className="row-title">{fmtDate(r.finished)} · {formatCount(r.responses.length, { one: "{n} item", other: "{n} items" })}</span>
                      <span className="row-sub">
                        {r.calibration.bias !== null ? `bias ${r.calibration.bias > 0 ? "+" : ""}${Math.round(r.calibration.bias)}` : "no predictions"}
                        {r.calibration.resolution !== null ? ` · r ${r.calibration.resolution.toFixed(2)}` : ""}
                        {r.usage.calls ? ` · ≈ $${r.usage.estimatedCost.toFixed(2)}` : ""}
                      </span>
                    </span>
                    <span className="row-end"><span>{r.responses.filter((x) => x.graph.newlyLit).length ? `+${r.responses.filter((x) => x.graph.newlyLit).length} lit` : ""}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Bias per session as a line around zero; resolution as dot size. Inline SVG, tokens for colour. */
function Spark({ points }: { points: AppState["calibration"] }) {
  const w = 560, h = 120, pad = 14;
  const maxAbs = Math.max(10, ...points.map((p) => Math.abs(p.bias)));
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - 2 * pad);
  const y = (b: number) => h / 2 - (b / maxAbs) * (h / 2 - pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.bias).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Bias from ${Math.round(points[0]!.bias)} to ${Math.round(points.at(-1)!.bias)} over ${points.length} sessions`}>
      <line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} stroke="var(--field-line)" strokeDasharray="3 4" />
      <text x={pad} y={pad} fontSize="10" fill="var(--fg3)">+{Math.round(maxAbs)} overconfident</text>
      <text x={pad} y={h - 4} fontSize="10" fill="var(--fg3)">−{Math.round(maxAbs)} underconfident</text>
      <path d={d} fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.bias)} r={p.resolution == null ? 3 : 3 + Math.max(0, p.resolution) * 5} fill="var(--bloom)" opacity=".9">
          <title>{`${fmtDate(p.finished)}: bias ${p.bias > 0 ? "+" : ""}${Math.round(p.bias)}${p.resolution != null ? `, resolution ${p.resolution.toFixed(2)}` : ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}
