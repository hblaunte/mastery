import type { ReactNode } from "react";
import { scoreBand } from "@mastery/ui";
import type { Usage } from "@mastery/shared";

export function Score({ value }: { value: number | null | undefined }) {
  return <span className={`score-pill ${scoreBand(value)}`} aria-label={value == null ? "not graded" : `score ${value}`}>{value ?? "!"}</span>;
}

/** A term with its definition one hover away. */
export function Tip({ label, text }: { label: ReactNode; text: string }) {
  return <span className="tip" tabIndex={0}>{label}<span role="tooltip">{text}</span></span>;
}

export function usageLine(usage: Usage | undefined): string {
  if (!usage?.calls) return "";
  const models = Object.entries(usage.perModel).map(([m, u]) => `${m} ×${u.calls}`).join(" · ");
  const cached = usage.cacheRead ? `${usage.cacheRead.toLocaleString()} tokens read from cache` : "no cache reads";
  return `${usage.calls} API calls · ${models} · ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out · ${cached} · ≈ $${usage.estimatedCost.toFixed(3)}`;
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

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
