/**
 * KnowledgeGraph: the 3D constellation of what you have mastered.
 *
 * Ported from the Universal Graph scene. Stars for nodes, light beams for
 * links, hover lights a node's beams, tap selects, the camera flies to the
 * selection and focus mode dims the rest. The component owns its wrapper (the
 * size it is given) rather than the page, so it can live in the shell's stage.
 *
 * The library's accessors are module-level so re-renders never rebuild the
 * scene; the registries they write to live in nodes.ts and beams.ts and are
 * emptied on unmount.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import * as THREE from "three";
import ForceGraph3D, {
  type ForceGraphMethods,
  type GraphData as FGGraphData,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import type { GraphData, GraphNode } from "@mastery/shared";
import {
  type SimLink,
  type SimNode,
  annotateGraph,
  colorOf,
  getNodeObject,
  idOf,
  motion,
  nodeSize,
  pulseNode,
  resetNodes,
  restBreathing,
  SCENE_BG_HEX,
  setFocus,
  setPalette,
  setReducedMotion,
  stepBreathing,
  stepFocusFades,
} from "./nodes";
import {
  beamDestination,
  beamTime,
  createBeam,
  isBeamHovered,
  litBeamsOf,
  positionBeam,
  resetBeams,
  setBeamDrift,
  setHoveredBeam,
  setHoveredNode,
  stepHoverFades,
} from "./beams";
import { BEAM_PICK_PX_MOUSE, BEAM_PICK_PX_TOUCH, isOnStar, pickBeam, useTapToSelect } from "./picking";
import { BeamLabel, EmptyState, Legend, NodeDetailPanel, PANEL_MAX_W, PANEL_MIN_W, escapeHtml, percent, stateLabel } from "./GraphPanels";
import "./graph.css";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface KnowledgeGraphProps {
  data: GraphData;
  width: number;
  height: number;
  /** The shell's theme; the canvas itself always renders on the dark void (#0A0C0F) because additive glow needs a dark ground. Panels follow the theme via tokens. */
  theme: "light" | "dark";
  /** Hex colour for a course id (the node's `domain`). Provided by the shell. */
  colorFor: (domainId: string) => string;
  onSelect?: (node: GraphNode | null) => void;
  /** "Study this" in the detail panel. */
  onStudy?: (node: GraphNode) => void;
  reducedMotion?: boolean;
}

// ── Library typing ────────────────────────────────────────────────────────────
// The library's own node/link object types, specialised to ours.
type LinkExtra = Omit<SimLink, "source" | "target">;
type FGNode = NodeObject<SimNode>;
type FGLink = LinkObject<SimNode, LinkExtra>;
type FGMethods = ForceGraphMethods<FGNode, FGLink>;
type FGData = FGGraphData<FGNode, FGLink>;

// ── Stable graph accessors ────────────────────────────────────────────────────
// Module-level so the library sees the same function every render.
const noop = () => {};
const nodeThreeObject = (node: FGNode) => getNodeObject(node as SimNode);
const nodeVal = (node: FGNode) => Math.max(1, (101 - (node as SimNode).abstraction) / 8);
const linkColor = () => "rgba(255,255,255,0.12)";
const linkWidth = (link: FGLink) => ((link as unknown as SimLink).similarity ?? 0.5) * 0.8;
const linkThreeObject = (link: FGLink) => createBeam(link as unknown as SimLink);
const onNodeHover = (node: FGNode | null) => { if (!isBeamHovered()) setHoveredNode(node as SimNode | null); };
const linkPosUpdate = (obj: THREE.Object3D, pos: { start: THREE.Vector3Like; end: THREE.Vector3Like }) => positionBeam(obj, pos);

// Tooltip: course title in the course colour, then state and mastery, then the label.
function nodeLabel(node: FGNode): string {
  const n = node as SimNode;
  return (
    `<div class="kg-tip">` +
    `<span class="kg-tip-course" style="color:${escapeHtml(colorOf(n.domain))}">${escapeHtml(n.domainTitle)}</span>` +
    `<span class="kg-tip-meta">${escapeHtml(stateLabel(n.state))} · ${percent(n.mastery)}</span>` +
    `<div class="kg-tip-label">${escapeHtml(n.label)}</div>` +
    `</div>`
  );
}

// ── Camera ────────────────────────────────────────────────────────────────────
// Flight to a selected node, and how early the pulse starts before arrival.
const CAMERA_FLIGHT_MS = 1200;
const PULSE_LEAD_MS = 250;
const FIRST_FLIGHT_MS = 1500;
const FIRST_FLIGHT_DISTANCE = 80;

// Camera distance from a selected node: 35 + 4 × its radius (≈ 40 small → ≈ 67 largest).
const FOCUS_DISTANCE_BASE = 35;
const FOCUS_DISTANCE_PER_RADIUS = 4;

// ── Layout spacing ────────────────────────────────────────────────────────────
// Every distance in the layout scaled by SPACING. Links rest at SPACING × the
// library default (30). Charge scales with SPACING², because its push weakens with
// distance while the spring's pull grows, so the layout keeps its shape, only bigger.
const SPACING = 1.5;
const LINK_DISTANCE = 30 * SPACING;
const CHARGE_STRENGTH = -30 * SPACING * SPACING;

// ── Panel width memory ────────────────────────────────────────────────────────
const PANEL_WIDTH_KEY = "mastery.graph.panelWidth";
const PANEL_WIDTH_DEFAULT = 340;

function readPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (saved >= PANEL_MIN_W && saved <= PANEL_MAX_W) return saved;
  } catch {
    /* storage blocked: use the default */
  }
  return PANEL_WIDTH_DEFAULT;
}

function writePanelWidth(w: number): void {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(w));
  } catch {
    /* storage blocked: the width lasts for this mount */
  }
}

// ── Reduced motion ────────────────────────────────────────────────────────────
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// ── Main component ────────────────────────────────────────────────────────────
export function KnowledgeGraph({ data, width, height, theme, colorFor, onSelect, onStudy, reducedMotion }: KnowledgeGraphProps): JSX.Element {
  const simData = useMemo(() => annotateGraph(data), [data]);
  // The caller's own node objects, handed back through onSelect / onStudy.
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n] as const)), [data]);
  const toPublic = useCallback((n: SimNode): GraphNode => byId.get(n.id) ?? n, [byId]);

  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const fgRef = useRef<FGMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasZoomedRef = useRef(false);

  const systemReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? systemReduced;
  const ready = width > 0 && height > 0 && data.nodes.length > 0;

  // Latest callbacks for the frame loop and the tap handler, without re-binding.
  const callbacks = useRef({ onSelect, onStudy, toPublic });
  callbacks.current = { onSelect, onStudy, toPublic };

  // ── Palette and motion: in place before the library builds any object ──────
  useLayoutEffect(() => {
    setPalette(colorFor);
  }, [colorFor]);

  useLayoutEffect(() => {
    setReducedMotion(reduced);
    setBeamDrift(reduced ? 0 : 1);
    if (reduced) restBreathing();
  }, [reduced]);

  const updatePanelWidth = useCallback((w: number) => {
    setPanelWidth(w);
    writePanelWidth(w);
  }, []);

  // ── Selection ───────────────────────────────────────────────────────────────
  const selectedRef = useRef<SimNode | null>(null);
  selectedRef.current = selectedNode;

  const select = useCallback((node: SimNode | null) => {
    // A background tap with nothing selected is not a change worth reporting.
    if ((node?.id ?? null) === (selectedRef.current?.id ?? null)) return;
    selectedRef.current = node;
    setSelectedNode(node);
    callbacks.current.onSelect?.(node ? callbacks.current.toPublic(node) : null);
  }, []);

  // When the data changes, the selection follows the node of the same id, or clears.
  useEffect(() => {
    const s = selectedRef.current;
    if (!s) return;
    const next = simData.nodes.find((n) => n.id === s.id) ?? null;
    if (next === s) return;
    selectedRef.current = next;
    setSelectedNode(next);
    if (!next) callbacks.current.onSelect?.(null);
  }, [simData]);

  // ── Camera: fly to a clicked node ───────────────────────────────────────────
  const handleNodeClick = useCallback((node: SimNode) => {
    select(node);

    const fg = fgRef.current;
    if (fg && node.x != null) {
      // Backed off for big nodes so their glow doesn't fill the screen.
      const distance = FOCUS_DISTANCE_BASE + nodeSize(node) * FOCUS_DISTANCE_PER_RADIUS;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y ?? 0, node.z ?? 0);
      fg.cameraPosition(
        { x: node.x * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio },
        { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
        CAMERA_FLIGHT_MS,
      );
    }
    // Pulse as the camera settles, so the light is seen rather than spent mid-flight.
    window.setTimeout(() => pulseNode(node), CAMERA_FLIGHT_MS - PULSE_LEAD_MS);
  }, [select]);

  // ── Camera: zoom to a random node on first engine stop ──────────────────────
  const handleEngineStop = useCallback(() => {
    if (hasZoomedRef.current || !fgRef.current || simData.nodes.length === 0) return;
    hasZoomedRef.current = true;

    const node = simData.nodes[Math.floor(Math.random() * simData.nodes.length)]!;

    window.setTimeout(() => {
      const fg = fgRef.current;
      if (!fg || node.x == null) return;
      const distRatio = 1 + FIRST_FLIGHT_DISTANCE / Math.hypot(node.x, node.y ?? 0, node.z ?? 0);
      fg.cameraPosition(
        { x: node.x * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio },
        { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
        FIRST_FLIGHT_MS,
      );
      // Same arrival pulse for the first-load jump.
      window.setTimeout(() => pulseNode(node), FIRST_FLIGHT_MS - PULSE_LEAD_MS);
    }, 500);
  }, [simData.nodes]);

  // ── Frame loop: beam drift clock, hover fades, focus fades, breathing ────────
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number) => {
      // Under reduced motion the drift clock stands still; hover and focus fades still run.
      const dt = Math.min(0.1, (now - last) / 1000);
      const t = (now - t0) / 1000;
      if (!reducedRef.current) beamTime.value = t;
      stepHoverFades(dt);
      stepFocusFades(dt);
      if (!motion.reduced) stepBreathing(t);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Unmount: nothing from this mount may linger in the shared registries.
      setHoveredBeam(null);
      setHoveredNode(null);
      resetNodes();
      resetBeams();
    };
  }, []);

  // ── Layout spacing: apply once the graph component has mounted ──────────────
  const forcesSetRef = useRef(false);
  useEffect(() => {
    if (!ready || forcesSetRef.current) return;
    let raf = 0;
    const apply = () => {
      const fg = fgRef.current;
      if (!fg) { raf = requestAnimationFrame(apply); return; } // not mounted yet
      fg.d3Force("link")?.distance(LINK_DISTANCE);
      fg.d3Force("charge")?.strength(CHARGE_STRENGTH);
      fg.d3ReheatSimulation();
      forcesSetRef.current = true;
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // ── Focus mode follows the selection ────────────────────────────────────────
  useEffect(() => {
    const id = selectedNode?.id ?? null;
    const neighbours = new Set<string>();
    if (id) {
      for (const l of simData.links) {
        const a = idOf(l.source), b = idOf(l.target);
        if (a === id) neighbours.add(b);
        else if (b === id) neighbours.add(a);
      }
    }
    setFocus(id, neighbours, litBeamsOf(id));
  }, [selectedNode, simData]);

  // ── Beam navigation: click a lit beam of the selected node to fly along it ──
  const [beamTip, setBeamTip] = useState<{ x: number; y: number; node: SimNode } | null>(null);

  const handleMiss = useCallback((e: PointerEvent, canvas: HTMLCanvasElement) => {
    const sel = selectedRef.current;
    const fg = fgRef.current;
    if (!sel || !fg) return false;
    const maxPx = e.pointerType === "touch" ? BEAM_PICK_PX_TOUCH : BEAM_PICK_PX_MOUSE;
    const entry = pickBeam(sel.id, e.clientX, e.clientY, fg.camera(), canvas.getBoundingClientRect(), maxPx);
    const dest = entry && beamDestination(entry);
    if (!dest) return false;
    setHoveredBeam(null);
    setBeamTip(null);
    delete wrapRef.current?.dataset.beamHover;
    handleNodeClick(dest);
    return true;
  }, [handleNodeClick]);

  // Mouse hover over a pickable beam: pointer cursor, preview glow, destination label.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !selectedNode) return;
    let raf = 0;
    let last: PointerEvent | null = null;
    const hoverRay = new THREE.Raycaster();
    const evaluate = () => {
      raf = 0;
      const e = last, fg = fgRef.current;
      const canvas = el.querySelector("canvas");
      if (!e || !fg || !canvas) return;
      // A star under the pointer takes priority over beams; its glow alone doesn't.
      const onStar = isOnStar(fg, canvas, e.clientX, e.clientY, hoverRay);
      const entry = onStar || !(e.target instanceof HTMLCanvasElement)
        ? null
        : pickBeam(selectedNode.id, e.clientX, e.clientY, fg.camera(), canvas.getBoundingClientRect(), BEAM_PICK_PX_MOUSE);
      const dest = entry && beamDestination(entry);
      setHoveredBeam(dest ? entry : null);
      el.style.cursor = dest ? "pointer" : "";
      // Hide the library's node tooltip while our beam label is up (see graph.css).
      if (dest) el.dataset.beamHover = "";
      else delete el.dataset.beamHover;
      if (dest) {
        const wr = el.getBoundingClientRect();
        setBeamTip({ x: e.clientX - wr.left, y: e.clientY - wr.top, node: dest });
      } else {
        setBeamTip(null);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return; // no hover on touch, none while dragging
      last = e;
      if (!raf) raf = requestAnimationFrame(evaluate);
    };
    const onLeave = () => {
      setHoveredBeam(null);
      setBeamTip(null);
      el.style.cursor = "";
      delete el.dataset.beamHover;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      onLeave();
    };
  }, [selectedNode]);

  // ── Tap to select: quick press-and-release picks the node under the pointer ──
  const deselect = useCallback(() => select(null), [select]);
  useTapToSelect(wrapRef, fgRef, handleNodeClick, deselect, handleMiss, ready);

  const handleStudy = useCallback((n: SimNode) => callbacks.current.onStudy?.(callbacks.current.toPublic(n)), []);

  const bounds = useMemo(() => ({ width, height }), [width, height]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      className="kg-wrap"
      data-theme={theme}
      data-reduced-motion={reduced ? "" : undefined}
      style={{ width, height }}
    >
      {data.nodes.length === 0 ? (
        <EmptyState threshold={data.threshold} pending={data.pending} />
      ) : (
        <>
          {/* ── 3D Graph ──────────────────────────────────────────────────── */}
          {ready && (
            <ForceGraph3D<SimNode, LinkExtra>
              ref={fgRef}
              width={width}
              height={height}
              graphData={simData as unknown as FGData}
              backgroundColor={SCENE_BG_HEX}
              showNavInfo={false}

              // ── Nodes ────────────────────────────────────────────────────
              nodeThreeObject={nodeThreeObject}
              nodeThreeObjectExtend={false}
              nodeVal={nodeVal}
              nodeLabel={nodeLabel}
              // Clicks are detected by useTapToSelect; this no-op keeps the pointer cursor.
              onNodeClick={noop}
              onNodeHover={onNodeHover}

              // ── Links ────────────────────────────────────────────────────
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkThreeObject={linkThreeObject}
              linkThreeObjectExtend={false}
              linkPositionUpdate={linkPosUpdate}

              // ── Physics ──────────────────────────────────────────────────
              d3AlphaDecay={0.015}
              d3VelocityDecay={0.25}
              warmupTicks={80}
              cooldownTicks={200}
              onEngineStop={handleEngineStop}
            />
          )}

          {/* ── Beam destination label ──────────────────────────────────────── */}
          {beamTip && <BeamLabel x={beamTip.x} y={beamTip.y} node={beamTip.node} color={colorFor(beamTip.node.domain)} />}

          {/* ── Focus vignette: darkens the edges while a node is open ──────── */}
          <div aria-hidden className={`kg-vignette${selectedNode ? " on" : ""}`} />

          {/* ── Node detail panel ───────────────────────────────────────────── */}
          {selectedNode && (
            <NodeDetailPanel
              node={selectedNode}
              color={colorFor(selectedNode.domain)}
              onClose={deselect}
              onStudy={onStudy ? handleStudy : undefined}
              panelWidth={panelWidth}
              onPanelWidthChange={updatePanelWidth}
            />
          )}

          {/* ── Course legend ───────────────────────────────────────────────── */}
          <Legend data={data} colorFor={colorFor} bounds={bounds} />
        </>
      )}
    </div>
  );
}
