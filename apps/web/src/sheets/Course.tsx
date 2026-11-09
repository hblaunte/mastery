import { useEffect, useState } from "react";
import type { ItemState, ItemType } from "@mastery/shared";
import { CloseButton, Icon } from "@mastery/ui/glass";
import { api, type CourseDetail } from "../api";
import { Spinner, usageLine } from "../components/bits";
import { fmtDate, useT, type T } from "../i18n";

interface Props {
  id: string;
  reload: () => Promise<void>;
  notify: (text: string, opts?: { error?: boolean }) => void;
  onClose: () => void;
  onBegin: (courseIds: string[]) => void;
  onRead: (sourceId: string, chunk?: number) => void;
}

function stateLabel(st: ItemState | null, t: T): string {
  if (!st || !st.seen) return t("not yet seen");
  const today = new Date().toISOString().slice(0, 10);
  const due = st.due && st.due <= today ? t("due") : t("next {date}", { date: st.due ?? "" });
  return `${st.lastScore ?? "—"} · ${st.retired ? t("retired") : due}`;
}

/** Short type chip: the enum values are code, the labels are not. */
export function shortType(type: ItemType, t: T): string {
  return type === "mcq" ? t("mc") : type === "recall" ? t("recall") : type === "essay" ? t("essay") : t("experiment");
}

export function CourseSheet({ id, reload, notify, onClose, onBegin, onRead }: Props) {
  const { t, locale } = useT();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.course(id).then(setCourse).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [id]);

  async function remove() {
    if (!course || !window.confirm(t("Delete \"{title}\"? Its items leave the schedule; your session history stays.", { title: course.title }))) return;
    try { await api.deleteCourse(id); await reload(); notify(t("Deleted {title}", { title: course.title })); onClose(); } catch (e) { notify(e instanceof Error ? e.message : String(e), { error: true }); }
  }

  if (error) return <><div className="sheet-bar"><CloseButton onClose={onClose} label={t("Close")} /></div><p className="form-error" role="alert">{error}</p></>;
  if (!course) return <><div className="sheet-bar"><CloseButton onClose={onClose} label={t("Close")} /></div><Spinner label={t("Opening…")} /></>;

  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} label={t("Close")} /></div>
      <h2 className="sheet-title" id="course-title">{course.title}</h2>
      <p className="lede">{course.description}</p>
      <p className="hint">{t("Built {date} with {model} in {seconds} s", { date: fmtDate(course.created, locale, {}), model: course.build.model, seconds: Math.round(course.build.seconds) })} · {usageLine(course.build.usage, t, locale)}</p>
      <div className="btn-row">
        <button type="button" className="cta auto" onClick={() => onBegin([course.id])}><Icon name="play" small />{t("Session on this course")}</button>
        <button type="button" className="cta ghost auto small" onClick={() => void remove()}>{t("Delete course")}</button>
      </div>
      {course.topics.map((tp, i) => {
        const items = course.items.filter((x) => x.topicId === tp.id);
        return (
          <section key={tp.id} className="glass" aria-labelledby={`t-${tp.id}`}>
            <div className="section-h"><h3 id={`t-${tp.id}`}>{i + 1}. {tp.title}</h3><span className="hint">{t("{n} items", { n: items.length })}</span></div>
            <div className="pad">
              <p className="muted" style={{ fontSize: 13.5 }}>{tp.summary}</p>
              {tp.prereq.length > 0 && <p className="hint">{t("After: {list}", { list: tp.prereq.map((p) => course.topics.find((x) => x.id === p)?.title ?? p).join(", ") })}</p>}
              {tp.grounding.length > 0 && (
                <p className="hint">{t("Grounded in")} {tp.grounding.slice(0, 3).map((g, j) => <span key={j}>{j > 0 && ", "}<button type="button" className="link" style={{ padding: 0 }} onClick={() => onRead(g.sourceId, g.chunk)}>{g.locator}</button></span>)}</p>
              )}
              <ul className="rows" style={{ padding: 0 }}>
                {items.map((x) => (
                  <li key={x.id} className="row static">
                    <span className="chip">{shortType(x.type, t)}</span>
                    <span className="row-main"><span className="row-title" style={{ whiteSpace: "normal" }}>{x.prompt}</span><span className="row-sub">{t("difficulty {n}", { n: x.difficulty })} · {stateLabel(x.state, t)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </>
  );
}
