import { useState, type CSSProperties } from "react";
import type { AppState } from "@mastery/shared";
import { Avatar, Icon } from "@mastery/ui/glass";
import { formatCount } from "@mastery/ui";
import { Empty } from "../components/bits";
import { useT } from "../i18n";
import type { TabId } from "../App";

interface Props {
  state: AppState | null;
  heroStyle: CSSProperties;
  onBegin: (courseIds?: string[], size?: number) => void;
  onCourse: (id: string) => void;
  onGo: (t: TabId) => void;
}

const SIZES = [5, 8, 12];

/** Study: choose which courses feed the next session, and how long it should be. */
export function Study({ state, heroStyle, onBegin, onCourse, onGo }: Props) {
  const { t, locale } = useT();
  const courses = state?.courses ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [size, setSize] = useState(state?.settings.sessionSize ?? 8);
  const chosen = courses.filter((c) => selected.size === 0 || selected.has(c.id));
  const due = chosen.reduce((n, c) => n + c.stats.due, 0);
  const fresh = chosen.reduce((n, c) => n + (c.stats.total - c.stats.seen), 0);

  return (
    <>
      <section className="hero enter" style={heroStyle}>
        <span className="overline">{selected.size ? t("{n} of {total} courses selected", { n: selected.size, total: courses.length }) : t("All courses")}</span>
        <p className="big"><span className="num">{due}</span><span className="unit">{t("due")}</span></p>
        <span className="hero-sub">{t("{fresh}. Items are graded only after you finish, and you cannot see an answer before you have committed to one.", { fresh: formatCount(fresh, { one: t("{n} item never seen"), other: t("{n} items never seen") }, locale) })}</span>
        <div className="seg" role="group" aria-label={t("Session length")}>
          {SIZES.map((n) => <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)}>{t("{n} items", { n })}</button>)}
        </div>
        <div className="hero-ctas">
          <button type="button" className="pill prime" disabled={!courses.length} onClick={() => onBegin(selected.size ? [...selected] : undefined, size)}><Icon name="play" small />{t("Begin session")}</button>
        </div>
      </section>
      <div className="narrow enter">
        <section className="glass" aria-labelledby="pick-title">
          <div className="section-h"><h2 id="pick-title">{t("Courses")}</h2>{selected.size > 0 && <button type="button" className="link" onClick={() => setSelected(new Set())}>{t("Select all")}</button>}</div>
          {!courses.length ? (
            <Empty title={t("Nothing to study yet")} action={<button type="button" className="cta auto" onClick={() => onGo("library")}>{t("Open the library")}</button>}>{t("Build a course from your sources first.")}</Empty>
          ) : (
            <ul className="rows">
              {courses.map((c) => {
                const on = selected.size === 0 || selected.has(c.id);
                return (
                  <li key={c.id} className={`row${selected.has(c.id) ? " sel" : ""}`} style={{ cursor: "default" }}>
                    <input
                      type="checkbox"
                      className="check"
                      checked={on}
                      aria-label={t("Include {title}", { title: c.title })}
                      onChange={() => {
                        const next = new Set(selected.size ? selected : courses.map((x) => x.id));
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        setSelected(next.size === courses.length ? new Set() : next);
                      }}
                    />
                    <Avatar name={c.title} />
                    <button type="button" className="link-like row-main" onClick={() => onCourse(c.id)}>
                      <span className="row-title">{c.title}</span>
                      <span className="row-sub">{t("{due} due · {seen} of {total} seen · {retired} retired", { due: c.stats.due, seen: c.stats.seen, total: c.itemCount, retired: c.stats.retired })}</span>
                      <span className="bars" aria-hidden="true">
                        {Array.from({ length: Math.min(24, c.itemCount) }, (_, i) => {
                          const litN = Math.round((c.stats.lit / Math.max(1, c.itemCount)) * Math.min(24, c.itemCount));
                          const dueN = Math.round((c.stats.due / Math.max(1, c.itemCount)) * Math.min(24, c.itemCount));
                          return <i key={i} className={i < litN ? "on" : i < litN + dueN ? "due" : ""} />;
                        })}
                      </span>
                    </button>
                    <span className="row-end"><span>{c.stats.meanScore ?? "—"}</span><span className="row-sub">{t("mean")}</span></span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
