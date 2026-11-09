/**
 * The HTML that sits over the canvas: the course legend (in a DraggablePip),
 * the node detail panel, the beam destination label and the empty state. All
 * positioned inside the graph wrapper, styled with the product's glass tokens.
 */

import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphData, ItemType, NodeState } from "@mastery/shared";
import { Icon } from "@mastery/ui/glass";
import { formatCount } from "@mastery/ui";
import { DraggablePip } from "./DraggablePip";
import type { SimNode } from "./nodes";
import { k, useT, type T } from "../i18n";

// ── Text helpers ──────────────────────────────────────────────────────────────
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STATE_LABEL: Record<NodeState, string> = { emerging: k("Emerging"), lit: k("Lit"), mastered: k("Mastered") };
export function stateLabel(state: NodeState, t: T): string {
  const key = STATE_LABEL[state];
  return key ? t(key) : state;
}

export function percent(mastery: number): string {
  return `${Math.round(Math.min(1, Math.max(0, mastery)) * 100)}%`;
}

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  mcq: k("Multiple choice"),
  recall: k("Recall"),
  essay: k("Essay"),
  experiment: k("Experiment"),
};

function litDate(iso: string, locale: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  try {
    return new Date(t).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

// ── Node detail panel ─────────────────────────────────────────────────────────
export const PANEL_MIN_W = 280;
export const PANEL_MAX_W = 700;

export function NodeDetailPanel({
  node,
  color,
  onClose,
  onStudy,
  panelWidth,
  onPanelWidthChange,
}: {
  node: SimNode;
  color: string;
  onClose: () => void;
  onStudy?: (node: SimNode) => void;
  panelWidth: number;
  onPanelWidthChange: (w: number) => void;
}) {
  // ── Drag-to-resize (left edge) ──────────────────────────────────────────────
  const dragStart = useRef<{ x: number; w: number } | null>(null);

  const handleResizeDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStart.current = { x: e.clientX, w: panelWidth };
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      if (!dragStart.current) return;
      // Dragging left (decreasing clientX) widens the panel
      const delta = dragStart.current.x - ev.clientX;
      onPanelWidthChange(Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, dragStart.current.w + delta)));
    }
    function onUp() {
      dragStart.current = null;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }, [panelWidth, onPanelWidthChange]);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const { t, tx, locale } = useT();
  const lit = node.litAt ? litDate(node.litAt, locale) : null;
  const typeKey = node.itemType ? ITEM_TYPE_LABEL[node.itemType] : null;
  const typeLabel = node.itemType ? (typeKey ? t(typeKey) : node.itemType) : null;
  const showContent = node.content.trim() !== "" && node.content.trim() !== node.label.trim();

  return (
    <aside
      aria-label={`${node.domainTitle}: ${node.label}`}
      className="glass kg-panel kg-note"
      style={{ width: `min(${panelWidth}px, calc(100% - 32px))` }}
      onKeyDown={onKey}
    >
      {/* Left-edge resize handle (pointer only; width is also remembered) */}
      <div aria-hidden="true" className="kg-resize" onPointerDown={handleResizeDown} />

      <div key={node.id} className="kg-note-body">
        <header className="kg-note-head">
          <span className="chip kg-course-chip" style={{ color }}>
            <span aria-hidden="true" className="kg-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            {node.domainTitle}
          </span>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="kg-icon-btn">
            <Icon name="close" small />
          </button>
        </header>

        <h2 className="kg-note-title">{node.label}</h2>

        <p className="kg-note-meta">
          <span className={`kg-state ${node.state}`}>{stateLabel(node.state, t)}</span>
          <span className="kg-sep" aria-hidden="true">·</span>
          {tx("{pct} mastery", { pct: <span className="kg-num">{percent(node.mastery)}</span> })}
          {lit && (
            <>
              <span className="kg-sep" aria-hidden="true">·</span>
              {tx("lit {date}", { date: <time dateTime={node.litAt}>{lit}</time> })}
            </>
          )}
          {typeLabel && (
            <>
              <span className="kg-sep" aria-hidden="true">·</span>
              {typeLabel}
            </>
          )}
        </p>

        {showContent && <p className="kg-note-content">{node.content}</p>}

        {node.tags.length > 0 && (
          <ul aria-label={t("Tags")} className="chips kg-tags">
            {node.tags.map((tag) => (
              <li key={tag} className="chip">{tag}</li>
            ))}
          </ul>
        )}

        {onStudy && (
          <div className="kg-note-actions">
            <button type="button" className="cta auto" onClick={() => onStudy(node)}>
              <Icon name="study" small />
              {t("Study this")}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
export function Legend({
  data,
  colorFor,
  bounds,
}: {
  data: GraphData;
  colorFor: (domainId: string) => string;
  bounds: { width: number; height: number };
}) {
  const { t, locale } = useT();
  const courses = useMemo(() => {
    const m = new Map<string, { title: string; count: number }>();
    for (const n of data.nodes) {
      const row = m.get(n.domain);
      if (row) row.count++;
      else m.set(n.domain, { title: n.domainTitle, count: 1 });
    }
    return [...m.entries()]
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [data.nodes]);

  return (
    <DraggablePip anchor="left" bounds={bounds} defaultEdge={24} defaultTop={300} panelWidth={220} tabLabel={t("Courses")} tabY={300} zIndex={10}>
      <section aria-labelledby="kg-legend-title" className="glass kg-panel kg-legend">
        <h2 id="kg-legend-title" className="overline kg-overline">{t("Courses")}</h2>

        <ul className="kg-legend-list">
          {courses.map((c) => {
            const color = colorFor(c.id);
            return (
              <li key={c.id} className="kg-legend-row">
                <span aria-hidden="true" className="kg-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span className="kg-legend-name">{c.title}</span>
                <span className="kg-legend-count kg-num">{c.count}</span>
              </li>
            );
          })}
        </ul>

        <p className="kg-legend-foot kg-num">
          {formatCount(data.nodes.length, { one: t("{n} node"), other: t("{n} nodes") }, locale)} · {formatCount(data.links.length, { one: t("{n} link"), other: t("{n} links") }, locale)} · {t("{n} not yet lit", { n: data.pending.toLocaleString(locale) })}
        </p>
        <p className="hint kg-num">{t("Nodes light at {n}", { n: data.threshold })}</p>
      </section>
    </DraggablePip>
  );
}

// ── Beam destination label ────────────────────────────────────────────────────
// Follows the pointer while it rests on a lit beam of the selected node.
export function BeamLabel({ x, y, node, color }: { x: number; y: number; node: SimNode; color: string }) {
  const { t } = useT();
  return (
    <div aria-hidden className="kg-tip kg-beam-tip" style={{ left: x + 14, top: y + 14 }}>
      <span className="kg-tip-go">{t("Go to")} </span>
      <span className="kg-tip-course" style={{ color }}>{node.domainTitle}</span>
      <span className="kg-tip-meta">{stateLabel(node.state, t)} · {percent(node.mastery)}</span>
      <div className="kg-tip-label">{node.label}</div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ threshold, pending }: { threshold: number; pending: number }) {
  const { t, locale } = useT();
  const below =
    pending === 0
      ? t("No answered items are below it yet.")
      : pending === 1
        ? t("1 answered item is below it.")
        : t("{n} answered items are below it.", { n: pending.toLocaleString(locale) });
  return (
    <div className="kg-empty" role="status">
      <p className="kg-empty-title">{t("Nothing lit yet.")}</p>
      <p className="kg-empty-body kg-num">
        {t("An item joins the graph once its latest score reaches {threshold}. {below}", { threshold, below })}
      </p>
    </div>
  );
}
