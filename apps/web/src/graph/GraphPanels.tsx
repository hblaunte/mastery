/**
 * The HTML that sits over the canvas: the course legend (in a DraggablePip),
 * the node detail panel, the beam destination label and the empty state. All
 * positioned inside the graph wrapper, styled with the product's glass tokens.
 */

import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphData, ItemType, NodeState } from "@mastery/shared";
import { Icon } from "@mastery/ui/glass";
import { DraggablePip } from "./DraggablePip";
import type { SimNode } from "./nodes";

// ── Text helpers ──────────────────────────────────────────────────────────────
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STATE_LABEL: Record<NodeState, string> = { emerging: "Emerging", lit: "Lit", mastered: "Mastered" };
export function stateLabel(state: NodeState): string {
  return STATE_LABEL[state] ?? state;
}

export function percent(mastery: number): string {
  return `${Math.round(Math.min(1, Math.max(0, mastery)) * 100)}%`;
}

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  mcq: "Multiple choice",
  recall: "Recall",
  essay: "Essay",
  experiment: "Experiment",
};

function litDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  try {
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

function plural(n: number, one: string, other: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : other}`;
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

  const lit = node.litAt ? litDate(node.litAt) : null;
  const typeLabel = node.itemType ? ITEM_TYPE_LABEL[node.itemType] ?? node.itemType : null;
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
          <button type="button" onClick={onClose} aria-label="Close" className="kg-icon-btn">
            <Icon name="close" small />
          </button>
        </header>

        <h2 className="kg-note-title">{node.label}</h2>

        <p className="kg-note-meta">
          <span className={`kg-state ${node.state}`}>{stateLabel(node.state)}</span>
          <span className="kg-sep" aria-hidden="true">·</span>
          <span className="kg-num">{percent(node.mastery)}</span> mastery
          {lit && (
            <>
              <span className="kg-sep" aria-hidden="true">·</span>
              lit <time dateTime={node.litAt}>{lit}</time>
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
          <ul aria-label="Tags" className="chips kg-tags">
            {node.tags.map((tag) => (
              <li key={tag} className="chip">{tag}</li>
            ))}
          </ul>
        )}

        {onStudy && (
          <div className="kg-note-actions">
            <button type="button" className="cta auto" onClick={() => onStudy(node)}>
              <Icon name="study" small />
              Study this
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
    <DraggablePip anchor="left" bounds={bounds} defaultEdge={24} defaultTop={300} panelWidth={220} tabLabel="Courses" tabY={300} zIndex={10}>
      <section aria-labelledby="kg-legend-title" className="glass kg-panel kg-legend">
        <h2 id="kg-legend-title" className="overline kg-overline">Courses</h2>

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
          {plural(data.nodes.length, "node", "nodes")} · {plural(data.links.length, "link", "links")} · {data.pending.toLocaleString()} not yet lit
        </p>
        <p className="hint kg-num">Nodes light at {data.threshold}</p>
      </section>
    </DraggablePip>
  );
}

// ── Beam destination label ────────────────────────────────────────────────────
// Follows the pointer while it rests on a lit beam of the selected node.
export function BeamLabel({ x, y, node, color }: { x: number; y: number; node: SimNode; color: string }) {
  return (
    <div aria-hidden className="kg-tip kg-beam-tip" style={{ left: x + 14, top: y + 14 }}>
      <span className="kg-tip-go">Go to </span>
      <span className="kg-tip-course" style={{ color }}>{node.domainTitle}</span>
      <span className="kg-tip-meta">{stateLabel(node.state)} · {percent(node.mastery)}</span>
      <div className="kg-tip-label">{node.label}</div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ threshold, pending }: { threshold: number; pending: number }) {
  const below =
    pending === 0
      ? "No answered items are below it yet."
      : pending === 1
        ? "1 answered item is below it."
        : `${pending.toLocaleString()} answered items are below it.`;
  return (
    <div className="kg-empty" role="status">
      <p className="kg-empty-title">Nothing lit yet.</p>
      <p className="kg-empty-body kg-num">
        An item joins the graph once its latest score reaches {threshold}. {below}
      </p>
    </div>
  );
}
