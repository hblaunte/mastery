import type { CSSProperties } from "react";
import type { AppState, SessionRecord } from "@mastery/shared";
import { Avatar, Icon } from "@mastery/ui/glass";
import { formatCount } from "@mastery/ui";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Score, fmtDate } from "../components/bits";
import { relativeAge, signed, useT } from "../i18n";
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
  const { t, locale } = useT();
  const [recent, setRecent] = useState<SessionRecord[]>([]);
  useEffect(() => { void api.history(6).then(setRecent).catch(() => setRecent([])); }, [state?.sessionsDone]);
  const due = state?.due ?? 0;
  const courses = state?.courses ?? [];
  const last = state?.calibration.at(-1);
  const sub = state
    ? [
      formatCount(state.fresh, { one: t("{n} never seen"), other: t("{n} never seen") }, locale),
      formatCount(state.graph.nodes, { one: t("{n} node lit"), other: t("{n} nodes lit") }, locale),
      formatCount(state.sessionsDone, { one: t("{n} session"), other: t("{n} sessions") }, locale),
    ].join(" · ")
    : "";

  return (
    <>
      <section className="hero enter" style={heroStyle} aria-label={t("{n} due for retrieval", { n: due })}>
        <span className="overline">{courses.length ? formatCount(courses.length, { one: t("{n} course"), other: t("{n} courses") }, locale) : t("Retrieval practice over your own sources")}</span>
        <p className="big"><span className="num" data-tour="due">{due}</span><span className="unit">{t("due")}</span></p>
        <span className="hero-sub">{sub}</span>
        <div className="hero-ctas">
          <button type="button" className="pill prime" data-tour="begin" onClick={onBegin} disabled={!courses.length}><Icon name="play" small />{t("Begin session")}</button>
        </div>
        <div className="actions">
          <button type="button" className="action" onClick={() => onGo("library")}><span className="disc ctrl"><Icon name="book" /></span>{t("Library")}</button>
          <button type="button" className="action" onClick={() => (state?.sources.length ? onBuild(state.sources.map((s) => s.id)) : onGo("library"))}><span className="disc ctrl"><Icon name="sparkle" /></span>{t("Build course")}</button>
          <button type="button" className="action" onClick={() => onGo("graph")}><span className="disc ctrl"><Icon name="graph" /></span>{t("Graph")}</button>
          <button type="button" className="action" onClick={() => onGo("progress")}><span className="disc ctrl"><Icon name="chart" /></span>{t("Progress")}</button>
        </div>
      </section>

      <div className="content enter">
        {!courses.length ? (
          <section className="glass" aria-labelledby="start-title">
            <Empty title={t("No courses yet")}>
              {t("Drop a PDF, a Markdown file or a URL into the library and Mastery builds a course from it: topics in dependency order, items with answer keys and rubrics, every one grounded in a passage you can open.")}
              <br />
              <span className="hint" style={{ display: "block", marginBlockStart: 8 }}>
                {state?.key.mode === "none" ? t("You will also need an API key, under the key icon at the top.") : ""}
              </span>
            </Empty>
            <div className="btn-row" style={{ justifyContent: "center", padding: "0 18px 22px" }}>
              <button type="button" className="cta auto" onClick={() => onGo("library")}>{t("Open the library")}</button>
            </div>
          </section>
        ) : (
          <div className="cols">
            <section className="glass" aria-labelledby="courses-title">
              <div className="section-h">
                <h2 id="courses-title">{t("Courses")}</h2>
                <button type="button" className="link" onClick={() => onGo("study")}>{t("Study")}</button>
              </div>
              <ul className="rows">
                {courses.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="row course-row" onClick={() => onCourse(c.id)}>
                      <Avatar name={c.title} />
                      <span className="row-main">
                        <span className="row-title">{c.title}</span>
                        <span className="row-sub">{t("{due} due · {lit} of {total} lit", { due: c.stats.due, lit: c.stats.lit, total: c.itemCount })} · {c.stats.meanScore !== null ? t("mean {n}", { n: c.stats.meanScore }) : t("not started")}</span>
                      </span>
                      <span className="row-end"><span>{t("{n} topics", { n: c.topicCount })}</span><span className="row-sub">{t("{n} items", { n: c.itemCount })}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="glass" aria-labelledby="recent-title">
              <div className="section-h">
                <h2 id="recent-title">{t("Recent sessions")}</h2>
                <button type="button" className="link" onClick={() => onGo("progress")}>{t("Progress")}</button>
              </div>
              {recent.length === 0 ? (
                <div className="empty" role="status"><strong>{t("No sessions yet")}</strong><span>{t("Your first session sets the baseline for calibration.")}</span></div>
              ) : (
                <ul className="rows">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="row" onClick={() => onSession(r)}>
                        <Score value={r.calibration.meanScore} />
                        <span className="row-main">
                          <span className="row-title">{formatCount(r.responses.length, { one: t("{n} item"), other: t("{n} items") }, locale)}</span>
                          <span className="row-sub">
                            {r.calibration.bias !== null ? t("bias {n}", { n: signed(r.calibration.bias) }) : ""}
                            {r.calibration.resolution !== null ? ` · ${t("r {n}", { n: r.calibration.resolution.toFixed(2) })}` : ""}
                          </span>
                        </span>
                        <span className="row-end"><span>{fmtDate(r.finished, locale)}</span><span className="row-sub">{relativeAge(r.finished, locale)}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {last && (
                <p className="hint" style={{ padding: "0 18px 16px" }}>
                  {last.resolution !== null
                    ? t("Last calibration: bias {bias}, resolution {res}.", { bias: signed(last.bias), res: last.resolution.toFixed(2) })
                    : t("Last calibration: bias {bias}.", { bias: signed(last.bias) })}
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
