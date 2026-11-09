/**
 * Picking: tap detection, raycast scoring of stars, and beam picking for
 * navigation. Nothing here changes the scene; it only answers "what is under
 * the pointer".
 */

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { type BeamEntry, beamsByNode } from "./beams";
import { type SimNode, nodeSize } from "./nodes";

// A loose view of the library's handle: only what picking needs.
export type GraphHandle = Pick<ForceGraphMethods, "camera" | "scene">;

// ── Tap detection ─────────────────────────────────────────────────────────────
// The graph library drops any mouse click that moves even 1px, and picks the
// target from a throttled hover check. Instead: a press released within
// TAP_MAX_MS and TAP_MAX_PX is a tap, and we raycast at the release point.
// Holding or dragging (rotate, pan, move a node) never selects anything.
const TAP_MAX_MS = 300;
const TAP_MAX_PX = 6;

export function useTapToSelect(
  wrapRef: RefObject<HTMLDivElement | null>,
  fgRef: RefObject<GraphHandle | undefined>,
  onNode: (node: SimNode) => void,
  onBackground: () => void,
  // Tried when no node is hit; return true if it handled the tap.
  onMiss: (e: PointerEvent, canvas: HTMLCanvasElement) => boolean,
  enabled: boolean,
): void {
  // Latest callbacks without re-binding listeners.
  const cb = useRef({ onNode, onBackground, onMiss });
  cb.current = { onNode, onBackground, onMiss };

  useEffect(() => {
    const el = wrapRef.current;
    if (!enabled || !el) return;
    const pointers = new Map<number, { x: number; y: number; t: number }>();
    let multiTouch = false;
    const raycaster = new THREE.Raycaster();

    function onDown(e: PointerEvent) {
      if (e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (pointers.size > 1) multiTouch = true;
    }

    function onUp(e: PointerEvent) {
      const start = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      const wasMulti = multiTouch;
      if (pointers.size === 0) multiTouch = false;
      if (!start || wasMulti) return;
      if (performance.now() - start.t > TAP_MAX_MS) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_MAX_PX) return;

      const fg = fgRef.current;
      const canvas = e.target instanceof HTMLCanvasElement ? e.target : el!.querySelector("canvas");
      if (!fg || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, fg.camera());
      const hit = pickNodeScored(raycaster, fg.scene());
      // A firm hit on a star selects it. A glow-only hit lets a beam underneath win first.
      if (hit && hit.score <= NODE_FIRM_HIT) cb.current.onNode(hit.node);
      else if (cb.current.onMiss(e, canvas)) return;
      else if (hit) cb.current.onNode(hit.node);
      else cb.current.onBackground();
    }

    function onCancel(e: PointerEvent) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) multiTouch = false;
    }

    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("pointerup", onUp, { capture: true });
    el.addEventListener("pointercancel", onCancel, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointerup", onUp, { capture: true });
      el.removeEventListener("pointercancel", onCancel, { capture: true });
    };
  }, [wrapRef, fgRef, enabled]);
}

// ── Node picking ──────────────────────────────────────────────────────────────
// Score is ray-to-centre distance over node size. The core's edge is 0.4; the
// glow reaches ~3.5. Below NODE_FIRM_HIT the pointer is clearly on the star
// itself; above it, it's only in the glow, and a beam under it should win.
export const NODE_FIRM_HIT = 1.0;

interface TaggedObject extends THREE.Object3D {
  __graphObjType?: string;
  __data?: SimNode;
}

// Among every node the ray touches (core or glow), pick the one whose centre is
// nearest the ray relative to its size, so overlapping glows choose the star
// you actually tapped.
export function pickNodeScored(raycaster: THREE.Raycaster, scene: THREE.Scene): { node: SimNode; score: number } | null {
  const hits = raycaster.intersectObjects(scene.children, true);
  let best: { node: SimNode; score: number } | null = null;
  const seen = new Set<THREE.Object3D>();
  for (const hit of hits) {
    let o: TaggedObject | null = hit.object;
    while (o && o.__graphObjType !== "node") o = o.parent;
    if (!o || seen.has(o)) continue;
    seen.add(o);
    const node = o.__data;
    if (!node) continue;
    const d = raycaster.ray.distanceToPoint(o.getWorldPosition(new THREE.Vector3()));
    const score = d / nodeSize(node);
    if (!best || score < best.score) best = { node, score };
  }
  return best;
}

// Whether the pointer at client (x, y) is firmly on a star (not just in a glow).
export function isOnStar(fg: GraphHandle, canvas: HTMLCanvasElement, clientX: number, clientY: number, raycaster: THREE.Raycaster): boolean {
  const rect = canvas.getBoundingClientRect();
  raycaster.setFromCamera(
    new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
    fg.camera(),
  );
  return (pickNodeScored(raycaster, fg.scene())?.score ?? Infinity) <= NODE_FIRM_HIT;
}

// ── Beam picking ──────────────────────────────────────────────────────────────
// With a node selected, its beams are clickable: clicking one flies to the node
// at the other end. Beams drift in the shader, so picking rebuilds each beam's
// current curve on the CPU with the same maths, projects it to the screen and
// measures the pointer's distance to it.
export const BEAM_PICK_PX_MOUSE = 12;
export const BEAM_PICK_PX_TOUCH = 22;
const BEAM_SAMPLES = 24;
const _bp = new THREE.Vector3();

// Same displacement as BEAM_VERTEX, in the beam's local frame (z = 0..1 along it).
function beamLocalPoint(u: THREE.ShaderMaterial["uniforms"], t: number, out: THREE.Vector3): THREE.Vector3 {
  const ph = u.uPhase!.value as number, T = u.uTime!.value as number;
  const env = Math.sin(Math.PI * t);
  const A = Math.min((u.uLen!.value as number) * 0.05, 3.0);
  const d = u.uDrift!.value as number;
  const wave = Math.sin(t * 9.4248 - T * 0.45 + ph * 5.0) * A * 0.18 * env;
  const x = Math.cos(ph) * A * 0.7 * env + (Math.sin(T * 0.31 + ph * 3.1) * A * 0.55 * env - Math.sin(ph) * wave) * d;
  const y = Math.sin(ph) * A * 0.7 * env + (Math.cos(T * 0.23 + ph * 1.7) * A * 0.55 * env + Math.cos(ph) * wave) * d;
  return out.set(x, y, t);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

// The beam of `nodeId` nearest the pointer (client coords), within `maxPx`.
export function pickBeam(
  nodeId: string,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  rect: DOMRect,
  maxPx: number,
): BeamEntry | null {
  let best: { entry: BeamEntry; d: number } | null = null;
  for (const entry of beamsByNode.get(nodeId) ?? []) {
    const { mesh, material } = entry;
    let prev: [number, number] | null = null;
    for (let i = 0; i <= BEAM_SAMPLES; i++) {
      const t = i / BEAM_SAMPLES;
      beamLocalPoint(material.uniforms, t, _bp);
      mesh.localToWorld(_bp).project(camera);
      if (_bp.z > 1) { prev = null; continue; } // behind the camera
      const sx = rect.left + ((_bp.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - _bp.y) / 2) * rect.height;
      if (prev) {
        const d = distToSegment(clientX, clientY, prev[0], prev[1], sx, sy);
        if (d <= maxPx && (!best || d < best.d)) best = { entry, d };
      }
      prev = [sx, sy];
    }
  }
  return best?.entry ?? null;
}
