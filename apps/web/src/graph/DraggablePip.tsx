/**
 * DraggablePip: picture-in-picture panel, living inside a positioned container.
 *
 * - Starts as a slim vertical tab docked to the container's edge.
 * - Click the tab → the panel floats into view.
 * - Drag the handle bar at the top of the floating panel to move it.
 * - Drag near the left or right edge → it snaps back into a tab.
 *
 * Positions are relative to the nearest positioned ancestor (the graph
 * wrapper), not the window, so the pip stays inside the shell's stage.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type DockSide = "left" | "right";

export interface DraggablePipProps {
  anchor: "left" | "right";
  /** The container's size; sets where the tab docks and keeps the panel inside. */
  bounds: { width: number; height: number };
  defaultEdge?: number; // px from anchor edge when floating
  defaultTop?: number;  // px from top when floating
  panelWidth?: number;  // used to calculate initial left position
  tabLabel: string;
  tabColor?: string;
  tabY?: number;        // vertical position of the docked tab
  zIndex?: number;
  children: ReactNode;
}

const DOCK_THRESHOLD = 80; // px from edge that triggers docking
const TAB_W = 28;          // width of the docked tab strip
const HANDLE_H = 24;       // height of the drag handle bar
const MIN_TAB_Y = 60;      // the tab never rides up under the shell's top bar

export function DraggablePip({
  anchor,
  bounds,
  defaultEdge = 24,
  defaultTop = 100,
  panelWidth = 340,
  tabLabel,
  tabColor = "var(--fg2)",
  tabY = 120,
  zIndex = 20,
  children,
}: DraggablePipProps) {
  // Start docked to anchor side
  const [docked, setDocked] = useState<DockSide | null>(anchor);
  const [liveTabY, setLiveTabY] = useState(tabY);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const origin = useRef({ mx: 0, my: 0, left: 0, top: 0 });

  // Client → container coordinates, via whichever of our elements is mounted.
  const containerLeft = useCallback((): number => {
    const host = (panelRef.current ?? tabRef.current)?.offsetParent;
    return host ? host.getBoundingClientRect().left : 0;
  }, []);

  // Init floating position
  useEffect(() => {
    const w = bounds.width;
    const initLeft = anchor === "right" ? w - defaultEdge - panelWidth : defaultEdge;
    setPos({ left: Math.max(8, initLeft), top: Math.max(8, defaultTop) });
    setLiveTabY(tabY);
    // Deliberately not re-run on resize: the panel keeps its place and is clamped below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, defaultEdge, defaultTop, panelWidth, tabY]);

  // Resize: keep a floating panel inside the container rather than resetting it.
  useEffect(() => {
    setPos((p) => {
      if (!p) return p;
      const left = Math.max(0, Math.min(p.left, bounds.width - panelWidth - 8));
      const top = Math.max(0, Math.min(p.top, bounds.height - HANDLE_H - 40));
      return left === p.left && top === p.top ? p : { left, top };
    });
  }, [bounds.width, bounds.height, panelWidth]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const startDrag = useCallback((clientX: number, clientY: number) => {
    if (!pos) return;
    dragging.current = true;
    moved.current = false;
    origin.current = { mx: clientX, my: clientY, left: pos.left, top: pos.top };
  }, [pos]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragging.current) return;
    moved.current = true;
    setPos({
      left: Math.max(0, origin.current.left + (clientX - origin.current.mx)),
      top: Math.max(0, origin.current.top + (clientY - origin.current.my)),
    });
  }, []);

  const endDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (!moved.current) return; // was a tap, not a drag
    const x = clientX - containerLeft();
    const host = (panelRef.current ?? tabRef.current)?.offsetParent;
    const y = clientY - (host ? host.getBoundingClientRect().top : 0);
    if (x < DOCK_THRESHOLD) {
      setDocked("left");
      setLiveTabY(Math.max(MIN_TAB_Y, y - 20));
    } else if (x > bounds.width - DOCK_THRESHOLD) {
      setDocked("right");
      setLiveTabY(Math.max(MIN_TAB_Y, y - 20));
    }
  }, [bounds.width, containerLeft]);

  // Global listeners: touchmove preventDefault only while dragging
  useEffect(() => {
    const mm = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);
    const mu = (e: MouseEvent) => endDrag(e.clientX, e.clientY);
    const tm = (e: TouchEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) moveDrag(t.clientX, t.clientY);
    };
    const te = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) endDrag(t.clientX, t.clientY);
    };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
    document.addEventListener("touchmove", tm, { passive: false });
    document.addEventListener("touchend", te);
    return () => {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
      document.removeEventListener("touchmove", tm);
      document.removeEventListener("touchend", te);
    };
  }, [moveDrag, endDrag]);

  // ── Undock: float panel near tab position ───────────────────────────────────
  const undock = () => {
    const w = bounds.width;
    const initLeft = anchor === "right" ? Math.max(8, w - defaultEdge - panelWidth) : Math.max(8, defaultEdge);
    setPos({
      left: Math.max(8, Math.min(initLeft, w - panelWidth - 8)),
      top: Math.max(16, liveTabY),
    });
    setDocked(null);
  };

  // ── Hide: dock to whichever edge the panel is nearer ──────────────────────────
  const dock = () => {
    const rect = panelRef.current?.getBoundingClientRect();
    const left = containerLeft();
    const side: DockSide = rect && rect.left - left + rect.width / 2 < bounds.width / 2 ? "left" : "right";
    setLiveTabY(Math.max(MIN_TAB_Y, pos?.top ?? liveTabY));
    setDocked(side);
  };

  // ── Docked: slim vertical tab ────────────────────────────────────────────────
  if (docked) {
    return (
      <button
        ref={tabRef}
        type="button"
        onClick={undock}
        aria-label={`Show ${tabLabel}`}
        className={`kg-pip-tab ${docked}`}
        style={{ top: Math.min(liveTabY, Math.max(MIN_TAB_Y, bounds.height - 120)), zIndex, width: TAB_W }}
      >
        <span className="kg-pip-tab-label" style={{ color: tabColor }}>
          {tabLabel}
        </span>
      </button>
    );
  }

  if (!pos) return null;

  // ── Floating panel ──────────────────────────────────────────────────────────
  return (
    <div ref={panelRef} className="kg-pip" style={{ left: pos.left, top: pos.top, zIndex }}>
      {/* Drag handle: the ONLY draggable surface */}
      <div
        className="kg-pip-handle"
        style={{ height: HANDLE_H }}
        onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) startDrag(t.clientX, t.clientY); }}
        title="Drag to move or dock"
      >
        <div className="kg-pip-grip" />
        <button
          type="button"
          onClick={dock}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          aria-label={`Hide ${tabLabel}`}
          title={`Hide ${tabLabel.toLowerCase()}`}
          className="kg-icon-btn kg-pip-hide"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M2 6h8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Panel content: fully interactive */}
      <div style={{ cursor: "default" }}>{children}</div>
    </div>
  );
}
