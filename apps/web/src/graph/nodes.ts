/**
 * Star nodes, the glow texture, focus-mode dimming, the click pulse and the
 * mastered breathing. This is the base module of the graph: beams.ts and
 * picking.ts import from here, never the other way round, so the module-level
 * registries have one owner.
 *
 * The registries are module-level on purpose: react-force-graph's accessors must
 * be the same function identity across renders or it rebuilds the scene, and the
 * accessors need somewhere to put what they make. resetNodes() empties them on
 * unmount, so a second mount starts clean.
 */

import * as THREE from "three";
import type { GraphData, GraphLink, GraphNode, LinkKind, NodeState } from "@mastery/shared";

// ── Simulation types ──────────────────────────────────────────────────────────
// react-force-graph writes positions onto nodes, swaps link endpoints for node
// objects, and hangs the rendered Object3D on the node as __threeObj.
export interface SimNode extends GraphNode {
  // Weighted degree, normalised 0–1 across the graph (see annotateGraph).
  centrality?: number;
  x?: number;
  y?: number;
  z?: number;
  __threeObj?: THREE.Object3D;
}

export interface SimLink extends Omit<GraphLink, "source" | "target"> {
  source: string | SimNode;
  target: string | SimNode;
  // Kind weight × similarity, 0–1: sets the beam's width and brightness.
  strength?: number;
  // Endpoint domains, for the beam's colour gradient (see annotateGraph).
  sourceDomain?: string;
  targetDomain?: string;
}

export interface SimData {
  nodes: SimNode[];
  links: SimLink[];
}

export const idOf = (end: string | SimNode): string => (typeof end === "string" ? end : end.id);

// ── Palette ───────────────────────────────────────────────────────────────────
// Colours come from the shell, one per course (the node's `domain`). Materials
// are cached per colour hex below, so two courses sharing a colour share them.
const FALLBACK_COLOR = "#cfd8ff";
let palette: (domain: string) => string = () => FALLBACK_COLOR;

export function setPalette(fn: (domain: string) => string): void {
  palette = fn;
}

export function colorOf(domain: string | undefined): string {
  if (domain === undefined) return FALLBACK_COLOR;
  return palette(domain) || FALLBACK_COLOR;
}

// ── Motion ────────────────────────────────────────────────────────────────────
// Set from the component (its prop, else prefers-reduced-motion). Read when a
// node is built and by the frame loop: breathing and the pulse's expansion stop.
export const motion = { reduced: false };

export function setReducedMotion(reduced: boolean): void {
  motion.reduced = reduced;
}

// ── Node size ─────────────────────────────────────────────────────────────────
// Abstraction 1   → radius ≈ 5.45  (broad topics, largest / centre)
// Abstraction 50  → radius ≈ 3.0
// Abstraction 100 → radius ≈ 0.5  (specific items, smallest)
function nodeRadius(abstraction: number): number {
  return 0.5 + (100 - abstraction) * 0.05;
}

// Items are small whatever their abstraction says: at least this specific, so
// radius 2 at most. Topics take the full range.
const ITEM_MIN_ABSTRACTION = 70;

// Centrality scales the abstraction-based radius from 0.8x (isolated) to 1.8x (most central).
const CENTRALITY_MIN_SCALE = 0.8;
const CENTRALITY_MAX_SCALE = 1.8;
const MAX_NODE_RADIUS = 8;

export function nodeSize(node: SimNode): number {
  const a = node.kind === "item" ? Math.max(ITEM_MIN_ABSTRACTION, node.abstraction) : node.abstraction;
  const base = nodeRadius(Math.min(100, Math.max(1, a)));
  const c = node.centrality ?? 0;
  const scale = CENTRALITY_MIN_SCALE + (CENTRALITY_MAX_SCALE - CENTRALITY_MIN_SCALE) * Math.sqrt(c);
  return Math.min(MAX_NODE_RADIUS, base * scale);
}

// ── State look ────────────────────────────────────────────────────────────────
// How a node's mastery state shows. Emerging: present but dim. Lit: the full
// star. Mastered: a touch larger, with a slow breath in the glow.
interface StateLook {
  core: number;        // multiplier on the core's brightness
  glowOpacity: number; // multiplier on the glow sprite's opacity
  coreRadius: number;  // multiplier on the core's radius
  glowScale: number;   // multiplier on the glow sprite's size
  breathe: boolean;
}

const STATE_LOOK: Record<NodeState, StateLook> = {
  emerging: { core: 0.8, glowOpacity: 0.45, coreRadius: 1, glowScale: 1, breathe: false },
  lit:      { core: 1, glowOpacity: 1, coreRadius: 1, glowScale: 1, breathe: false },
  mastered: { core: 1, glowOpacity: 1, coreRadius: 1.25, glowScale: 1.2, breathe: true },
};

export function stateLook(state: NodeState): StateLook {
  return STATE_LOOK[state] ?? STATE_LOOK.lit;
}

// The glow sprite's diameter, which the pulse matches.
export function glowDiameter(node: SimNode): number {
  return nodeSize(node) * 7 * stateLook(node.state).glowScale;
}

// ── Annotation ────────────────────────────────────────────────────────────────
// Link strength by kind: "member" threads (topic ↔ item) are thin and quiet,
// "prereq" medium, "concept" (a shared missed concept) brightest. Similarity
// scales each. Not rescaled across the graph, so a graph of member links alone
// stays quiet rather than being stretched to full brightness.
const KIND_WEIGHT: Record<LinkKind, number> = { member: 0.3, prereq: 0.6, concept: 1.0 };

// Copies the data into simulation objects (the library mutates them) and writes
// `centrality` onto nodes and `strength` + endpoint domains onto links.
export function annotateGraph(data: GraphData): SimData {
  const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
  const links: SimLink[] = data.links.map((l) => ({ ...l }));

  const domainOf = new Map(nodes.map((n) => [n.id, n.domain] as const));
  const degree = new Map<string, number>();
  for (const l of links) {
    const sim = Math.min(1, Math.max(0, l.similarity ?? 0.5));
    const w = (KIND_WEIGHT[l.kind] ?? 0.5) * sim;
    l.strength = w;
    l.sourceDomain = domainOf.get(idOf(l.source));
    l.targetDomain = domainOf.get(idOf(l.target));
    for (const id of [idOf(l.source), idOf(l.target)]) {
      degree.set(id, (degree.get(id) ?? 0) + w);
    }
  }
  const maxDeg = Math.max(0, ...degree.values());
  for (const n of nodes) {
    n.centrality = maxDeg > 0 ? (degree.get(n.id) ?? 0) / maxDeg : 0;
  }
  return { nodes, links };
}

// ── Glow texture ──────────────────────────────────────────────────────────────
// One shared radial gradient for every glow sprite and pulse wave. The library
// disposes a removed node's texture along with its material; three re-uploads
// it on next use, so sharing is safe.
let glowTexture: THREE.Texture | null = null;

export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Roughly Gaussian falloff: bright pinpoint, quick drop, long faint tail.
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.08, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.32)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.10)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.025)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

// ── Focus mode ────────────────────────────────────────────────────────────────
// While a node is selected, it and its direct neighbours stay lit, the threads
// joining them stay lit, and everything else recedes toward the background.
export interface Dimmable {
  dim: number;
  target: number;
  apply: (d: number) => void;
}

// The canvas ground. Kept in step with the product's dark --bg and the wrapper's
// background in graph.css: dimmed cores lerp toward it, so it must match.
export const SCENE_BG_HEX = "#0A0C0F";
export const SCENE_BG = new THREE.Color(SCENE_BG_HEX);

export const nodeDims = new Map<string, Dimmable>();
export const beamDims = new Map<THREE.ShaderMaterial, Dimmable>();
export const activeDims = new Set<Dimmable>();
const FOCUS_FADE_S = 0.6;
export const DIM_BACKGROUND = 0.82; // unrelated nodes and threads
export const DIM_NEIGHBOUR = 0.25;  // directly connected nodes: present, but secondary

export function dimTo(d: Dimmable, target: number): void {
  d.target = target;
  if (d.dim !== target) activeDims.add(d);
}

// `litBeams` are the materials of the selected node's own threads (beams.ts
// knows which; see litBeamsOf).
export function setFocus(selectedId: string | null, neighbourIds: Set<string>, litBeams: Set<THREE.ShaderMaterial>): void {
  for (const [id, d] of nodeDims) {
    dimTo(d, !selectedId || id === selectedId ? 0 : neighbourIds.has(id) ? DIM_NEIGHBOUR : DIM_BACKGROUND);
  }
  for (const [material, d] of beamDims) {
    dimTo(d, !selectedId || litBeams.has(material) ? 0 : DIM_BACKGROUND);
  }
}

export function stepFocusFades(dt: number): void {
  const step = dt / FOCUS_FADE_S;
  for (const d of activeDims) {
    d.dim = d.target > d.dim ? Math.min(d.target, d.dim + step) : Math.max(d.target, d.dim - step);
    d.apply(d.dim);
    if (d.dim === d.target) activeDims.delete(d);
  }
}

// ── Mastered breathing ────────────────────────────────────────────────────────
// A mastered node's glow swells and settles over four seconds. The step runs
// after the focus fades each frame, so it respects the node's dim. Under reduced
// motion it is never stepped and the glow holds its resting opacity.
const BREATH_PERIOD_S = 4;
const BREATH_DEPTH = 0.18; // the glow swings between 0.82× and 1× its resting opacity

interface Breather {
  material: THREE.SpriteMaterial;
  base: number;
  dim: Dimmable;
  phase: number;
}
const breathers = new Map<string, Breather>();

export function stepBreathing(t: number): void {
  for (const b of breathers.values()) {
    const wave = 0.5 + 0.5 * Math.sin((t / BREATH_PERIOD_S) * Math.PI * 2 + b.phase);
    b.material.opacity = b.base * (1 - b.dim.dim) * (1 - BREATH_DEPTH * (1 - wave));
  }
}

// Every mastered glow back at rest, for when motion is reduced mid-session.
export function restBreathing(): void {
  for (const b of breathers.values()) b.material.opacity = b.base * (1 - b.dim.dim);
}

// Cheap stable hash → 0..2π, so a node keeps its breath phase across rebuilds.
function phaseOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

// ── Three.js node object factory (cached materials per colour) ────────────────
// Each node is a star: a small, near-white core plus a soft additive glow sprite.
// The sprite always faces the camera and falls off smoothly, so there is no hard
// sphere edge, and overlapping glows brighten each other like real light.
const coreCache = new Map<string, THREE.MeshBasicMaterial>();
const glowCache = new Map<string, THREE.SpriteMaterial>();

export function getNodeObject(node: SimNode): THREE.Group {
  const colorHex = colorOf(node.domain);
  const radius = nodeSize(node);
  const look = stateLook(node.state);

  if (!coreCache.has(colorHex)) {
    // Hot core: the course colour pulled 55% toward white, like a star's centre.
    const core = new THREE.Color(colorHex).lerp(new THREE.Color("#ffffff"), 0.55);
    coreCache.set(colorHex, new THREE.MeshBasicMaterial({ color: core }));
    glowCache.set(
      colorHex,
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: colorHex,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  }

  const group = new THREE.Group();

  // Per-node copies of the shared materials, so focus mode can dim each node alone.
  const coreMat = coreCache.get(colorHex)!.clone();
  const glowMat = glowCache.get(colorHex)!.clone();
  coreMat.color.multiplyScalar(look.core);
  glowMat.opacity *= look.glowOpacity;

  // Core: 40% of the old size, so the glow carries the colour, not the solid.
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 0.4 * look.coreRadius, 12, 12), coreMat));

  // Glow: soft camera-facing sprite, about 7x the core radius across.
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(radius * 7 * look.glowScale);
  group.add(glow);

  const baseCore = coreMat.color.clone();
  const baseOpacity = glowMat.opacity;
  const prev = nodeDims.get(node.id);
  const entry: Dimmable = {
    dim: prev?.dim ?? 0,
    target: prev?.target ?? 0,
    apply: (d) => {
      coreMat.color.copy(baseCore).lerp(SCENE_BG, d);
      glowMat.opacity = baseOpacity * (1 - d);
    },
  };
  if (prev) activeDims.delete(prev);
  nodeDims.set(node.id, entry);
  entry.apply(entry.dim);
  if (entry.dim !== entry.target) activeDims.add(entry);

  if (look.breathe) {
    breathers.set(node.id, { material: glowMat, base: baseOpacity, dim: entry, phase: phaseOf(node.id) });
  } else {
    breathers.delete(node.id);
  }

  // The library disposes a removed node's materials: drop its registry entries
  // then, unless the id has since been rebuilt with a fresh object.
  glowMat.addEventListener("dispose", () => {
    if (nodeDims.get(node.id) === entry) {
      nodeDims.delete(node.id);
      activeDims.delete(entry);
    }
    if (breathers.get(node.id)?.material === glowMat) breathers.delete(node.id);
  });

  return group;
}

// ── Click pulse ───────────────────────────────────────────────────────────────
// Two soft light waves in the node's colour, attached to the node's own object so
// they follow it if the simulation is still moving: a quick bright bloom and a
// slower, wider wave that fades as it spreads. Under reduced motion the light
// only brightens and fades in place, with no expansion.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function pulseNode(node: SimNode): void {
  // react-force-graph stores the rendered object on the node.
  const host = node.__threeObj;
  if (!host) return;

  const colorHex = colorOf(node.domain);
  const base = glowDiameter(node); // matches the glow sprite
  const still = motion.reduced;

  const waves = [
    { from: 1.0, to: still ? 1.0 : 1.8, opacity: 0.9, duration: 600 },
    { from: 1.0, to: still ? 1.0 : 4.5, opacity: 0.45, duration: 1500 },
  ];

  for (const w of waves) {
    const material = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: colorHex,
      transparent: true,
      opacity: w.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(base * w.from);
    host.add(sprite);

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / w.duration);
      const e = easeOutCubic(t);
      sprite.scale.setScalar(base * (w.from + (w.to - w.from) * e));
      material.opacity = w.opacity * (1 - e);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        host.remove(sprite);
        material.dispose();
      }
    };
    requestAnimationFrame(step);
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
// Called on unmount. The library disposes every object on teardown, which
// already clears most of this through the dispose listeners; this makes sure
// nothing from one mount leaks into the next. The material caches and the glow
// texture are kept: they are GPU-cheap and valid for any renderer.
export function resetNodes(): void {
  nodeDims.clear();
  beamDims.clear();
  activeDims.clear();
  breathers.clear();
}
