import type { CSSProperties } from "react";
import type { AppState, SessionRecord } from "@mastery/shared";
import { Avatar, Icon } from "@mastery/ui/glass";
import { formatCount, shortAge } from "@mastery/ui";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Score, fmtDate } from "../components/bits";
import type { TabId } from "../App";

interface Props {
  state: AppState | null;
  heroStyle: CSSProperties;
  onBegin: () => void;
  onGo: (t: TabId) => void;
  onBuild: (sourceIds: string[]) => void;
  onCourse: (id: string) => void;
  onSession: (r: SessionRecord) => void;
}

/** Home answers "what is due?" and gets you into a session in one press. */
export function Home({ state, heroStyle, onBegin, onGo, onBuild, onCourse, onSession }: Props) {
  const [recent, setRecent] = useState<SessionRecord[]>([]);
  useEffect(() => { void api.history(6).then(setRecent).catch(() => setRecent([])); }, [state?.sessionsDone]);
  const due = state?.due ?? 0;
  const courses = state?.courses ?? [];
  const last = state?.calibration.at(-1);
  const sub = state
    ? [formatCount(state.fresh, { one: "{n} never seen", other: "{n} never seen" }), formatCount(state.graph.nodes, { one: "{n} node lit", other: "{n} nodes lit" }), formatCount(state.sessionsDone, { one: "{n} session", other: "{n} sessions" })].join(" · ")
    : "";

  return (
    <>
      <section className="hero enter" style={heroStyle} aria-label={`${due} due for retrieval`}>
        <span className="overline">{courses.length ? formatCount(courses.length, { one: "{n} course", other: "{n} courses" }) : "Retrieval practice over your own sources"}</span>
        <p className="big"><span className="num" data-tour="due">{due}</span><span className="unit">due</span></p>
        <span className="hero-sub">{sub}</span>
        <div className="hero-ctas">
          <button type="button" className="pill prime" data-tour="begin" onClick={onBegin} disabled={!courses.length}><Icon name="play" small />Begin session</button>
        </div>
        <div className="actions">
          <button type="button" className="action" onClick={() => onGo("library")}><span className="disc ctrl"><Icon name="book" /></span>Library</button>
          <button type="button" className="action" onClick={() => (state?.sources.length ? onBuild(state.sources.map((s) => s.id)) : onGo("library"))}><span className="disc ctrl"><Icon name="sparkle" /></span>Build course</button>
          <button type="button" className="action" onClick={() => onGo("graph")}><span className="disc ctrl"><Icon name="graph" /></span>Graph</button>
          <button type="button" className="action" onClick={() => onGo("progress")}><span className="disc ctrl"><Icon name="chart" /></span>Progress</button>
        </div>
      </section>

      <div className="content enter">
        {!courses.length ? (
          <section className="glass" aria-labelledby="start-title">
            <Empty title="No courses yet">
              Drop a PDF, a Markdown file or a URL into the library and Mastery builds a course from it: topics in dependency order, items with answer keys and rubrics, every one grounded in a passage you can open.
              <br />
              <span className="hint" style={{ display: "block", marginBlockStart: 8 }}>
                {state?.key.mode === "none" ? "You will also need an API key, under the key icon at the top." : ""}
              </span>
            </Empty>
            <div className="btn-row" style={{ justifyContent: "center", padding: "0 18px 22px" }}>
              <button type="button" className="cta auto" onClick={() => onGo("library")}>Open the library</button>
            </div>
          </section>
        ) : (
          <div className="cols">
            <section className="glass" aria-labelledby="courses-title">
              <div className="section-h">
                <h2 id="courses-title">Courses</h2>
                <button type="button" className="link" onClick={() => onGo("study")}>Study</button>
              </div>
              <ul className="rows">
                {courses.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="row course-row" onClick={() => onCourse(c.id)}>
                      <Avatar name={c.title} />
                      <span className="row-main">
                        <span className="row-title">{c.title}</span>
                        <span className="row-sub">{c.stats.due} due · {c.stats.lit} of {c.itemCount} lit · {c.stats.meanScore !== null ? `mean ${c.stats.meanScore}` : "not started"}</span>
                      </span>
                      <span className="row-end"><span>{c.topicCount} topics</span><span className="row-sub">{c.itemCount} items</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="glass" aria-labelledby="recent-title">
              <div className="section-h">
                <h2 id="recent-title">Recent sessions</h2>
                <button type="button" className="link" onClick={() => onGo("progress")}>Progress</button>
              </div>
              {recent.length === 0 ? (
                <div className="empty" role="status"><strong>No sessions yet</strong><span>Your first session sets the baseline for calibration.</span></div>
              ) : (
                <ul className="rows">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="row" onClick={() => onSession(r)}>
                        <Score value={r.calibration.meanScore} />
                        <span className="row-main">
                          <span className="row-title">{formatCount(r.responses.length, { one: "{n} item", other: "{n} items" })}</span>
                          <span className="row-sub">
                            {r.calibration.bias !== null ? `bias ${r.calibration.bias > 0 ? "+" : ""}${Math.round(r.calibration.bias)}` : ""}
                            {r.calibration.resolution !== null ? ` · r ${r.calibration.resolution.toFixed(2)}` : ""}
                          </span>
                        </span>
                        <span className="row-end"><span>{fmtDate(r.finished)}</span><span className="row-sub">{shortAge(r.finished)}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {last && (
                <p className="hint" style={{ padding: "0 18px 16px" }}>
                  Last calibration: bias {last.bias > 0 ? "+" : ""}{Math.round(last.bias)}{last.resolution !== null ? `, resolution ${last.resolution.toFixed(2)}` : ""}.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
