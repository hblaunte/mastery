import type { ReactNode } from "react";
import { scoreBand } from "@mastery/ui";
import type { Usage } from "@mastery/shared";
import { useT, type T } from "../i18n";

export { fmtDate } from "../i18n";

export function Score({ value }: { value: number | null | undefined }) {
  const { t } = useT();
  return <span className={`score-pill ${scoreBand(value)}`} aria-label={value == null ? t("not graded") : t("score {n}", { n: value })}>{value ?? "!"}</span>;
}

/** A term with its definition one hover away. */
export function Tip({ label, text }: { label: ReactNode; text: string }) {
  return <span className="tip" tabIndex={0}>{label}<span role="tooltip">{text}</span></span>;
}

export function usageLine(usage: Usage | undefined, t: T, locale: string): string {
  if (!usage?.calls) return "";
  const models = Object.entries(usage.perModel).map(([m, u]) => `${m} ×${u.calls}`).join(" · ");
  const cached = usage.cacheRead ? t("{n} tokens read from cache", { n: usage.cacheRead.toLocaleString(locale) }) : t("no cache reads");
  return t("{calls} API calls · {models} · {in} in / {out} out · {cached} · ≈ ${cost}", {
    calls: usage.calls,
    models,
    in: usage.input.toLocaleString(locale),
    out: usage.output.toLocaleString(locale),
    cached,
    cost: usage.estimatedCost.toFixed(3),
  });
}

export function Spinner({ label }: { label: string }) {
  return <div className="busy" role="status"><span className="busy-ring" aria-hidden="true" /><span className="muted">{label}</span></div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
      {action && <div className="btn-row" style={{ marginBlockStart: 8 }}>{action}</div>}
    </div>
  );
}
