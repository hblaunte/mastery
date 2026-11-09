import { useEffect, useState } from "react";
import type { ItemState } from "@mastery/shared";
import { CloseButton, Icon } from "@mastery/ui/glass";
import { api, type CourseDetail } from "../api";
import { Spinner, usageLine } from "../components/bits";

interface Props {
  id: string;
  reload: () => Promise<void>;
  notify: (text: string, opts?: { error?: boolean }) => void;
  onClose: () => void;
  onBegin: (courseIds: string[]) => void;
  onRead: (sourceId: string, chunk?: number) => void;
}

function stateLabel(st: ItemState | null): string {
  if (!st || !st.seen) return "not yet seen";
  const today = new Date().toISOString().slice(0, 10);
  const due = st.due && st.due <= today ? "due" : `next ${st.due}`;
  return `${st.lastScore ?? "—"} · ${st.retired ? "retired" : due}`;
}

export function CourseSheet({ id, reload, notify, onClose, onBegin, onRead }: Props) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.course(id).then(setCourse).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [id]);

  async function remove() {
    if (!course || !window.confirm(`Delete "${course.title}"? Its items leave the schedule; your session history stays.`)) return;
    try { await api.deleteCourse(id); await reload(); notify(`Deleted ${course.title}`); onClose(); } catch (e) { notify(e instanceof Error ? e.message : String(e), { error: true }); }
  }

  if (error) return <><div className="sheet-bar"><CloseButton onClose={onClose} /></div><p className="form-error" role="alert">{error}</p></>;
  if (!course) return <><div className="sheet-bar"><CloseButton onClose={onClose} /></div><Spinner label="Opening…" /></>;

  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} /></div>
      <h2 className="sheet-title" id="course-title">{course.title}</h2>
      <p className="lede">{course.description}</p>
      <p className="hint">Built {new Date(course.created).toLocaleDateString()} with {course.build.model} in {Math.round(course.build.seconds)} s · {usageLine(course.build.usage)}</p>
      <div className="btn-row">
        <button type="button" className="cta auto" onClick={() => onBegin([course.id])}><Icon name="play" small />Session on this course</button>
        <button type="button" className="cta ghost auto small" onClick={() => void remove()}>Delete course</button>
      </div>
      {course.topics.map((t, i) => {
        const items = course.items.filter((x) => x.topicId === t.id);
        return (
          <section key={t.id} className="glass" aria-labelledby={`t-${t.id}`}>
            <div className="section-h"><h3 id={`t-${t.id}`}>{i + 1}. {t.title}</h3><span className="hint">{items.length} items</span></div>
            <div className="pad">
              <p className="muted" style={{ fontSize: 13.5 }}>{t.summary}</p>
              {t.prereq.length > 0 && <p className="hint">After: {t.prereq.map((p) => course.topics.find((x) => x.id === p)?.title ?? p).join(", ")}</p>}
              {t.grounding.length > 0 && (
                <p className="hint">Grounded in {t.grounding.slice(0, 3).map((g, j) => <span key={j}>{j > 0 && ", "}<button type="button" className="link" style={{ padding: 0 }} onClick={() => onRead(g.sourceId, g.chunk)}>{g.locator}</button></span>)}</p>
              )}
              <ul className="rows" style={{ padding: 0 }}>
                {items.map((x) => (
                  <li key={x.id} className="row static">
                    <span className="chip">{x.type === "mcq" ? "mc" : x.type}</span>
                    <span className="row-main"><span className="row-title" style={{ whiteSpace: "normal" }}>{x.prompt}</span><span className="row-sub">difficulty {x.difficulty} · {stateLabel(x.state)}</span></span>
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
