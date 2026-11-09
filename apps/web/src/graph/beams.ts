/**
 * Light-beam links. Each link is a thin thread of light, not a taut wire. A
 * shader draws a bright core that fades into a soft glow at the edges, fading
 * from one endpoint's colour to the other's. The thread bows slightly and drifts
 * slowly, like something light hanging in still air. Strength sets its width
 * and brightness.
 *
 * Also here: the beam registry (which beams touch which node), the hover
 * highlight that lights a node's beams in its colour, and beam hover for
 * navigation. Picking (where the pointer is relative to a beam) is in picking.ts.
 */

import * as THREE from "three";
import {
  type Dimmable,
  type SimLink,
  type SimNode,
  activeDims,
  beamDims,
  colorOf,
  idOf,
} from "./nodes";

// ── Clock and motion ──────────────────────────────────────────────────────────
export const beamTime = { value: 0 }; // shared by every beam, advanced in the frame loop
let beamDrift = 1;                    // 0 under reduced motion: keep the bow, stop the drift

export function setBeamDrift(drift: 0 | 1): void {
  beamDrift = drift;
  // Existing threads follow too, so a preference change lands at once.
  for (const material of beamDims.keys()) material.uniforms.uDrift!.value = drift;
}

// ── Geometry ──────────────────────────────────────────────────────────────────
// One shared unit tube: radius 1, length 0→1 along +z (the frame lookAt uses).
let beamGeometry: THREE.BufferGeometry | null = null;
function getBeamGeometry(): THREE.BufferGeometry {
  if (beamGeometry) return beamGeometry;
  const g = new THREE.CylinderGeometry(1, 1, 1, 10, 32, true);
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.5, 0));
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  beamGeometry = g;
  return g;
}

// ── Shaders ───────────────────────────────────────────────────────────────────
export const BEAM_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uLen;
  uniform float uPhase;
  uniform float uRadius;
  uniform float uDrift;
  varying float vT;
  varying vec3  vN;
  varying vec3  vV;

  void main() {
    vec3  p   = position;
    float t   = p.z;
    p.xy     *= uRadius;

    // Slack scales with length but is capped, so long threads don't swing wildly.
    float env = sin(3.14159265 * t);
    float A   = min(uLen * 0.05, 3.0);

    // A permanent gentle bow in a per-link direction: never pulled straight.
    vec2 bow    = vec2(cos(uPhase), sin(uPhase)) * A * 0.7 * env;
    // Slow drift on two axes at different rates, so each thread wanders.
    vec2 drift  = vec2(sin(uTime * 0.31 + uPhase * 3.1),
                       cos(uTime * 0.23 + uPhase * 1.7)) * A * 0.55 * env;
    // A faint wave travelling along the thread.
    float wave  = sin(t * 9.4248 - uTime * 0.45 + uPhase * 5.0) * A * 0.18 * env;
    vec2 ripple = vec2(-sin(uPhase), cos(uPhase)) * wave;

    p.xy += bow + (drift + ripple) * uDrift;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vT = t;
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const BEAM_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uStrength;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform float uDim;       // 0..1 focus-mode dimming, eased on the CPU
  uniform float uHi;        // 0..1 hover highlight, eased on the CPU
  uniform float uHiEnd;     // which end the hovered node is at: 0 = source, 1 = target
  uniform vec3  uHiColor;
  varying float vT;
  varying vec3  vN;
  varying vec3  vV;

  void main() {
    // 1 at the tube's visual centre line, 0 at its silhouette.
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float core   = pow(facing, 10.0);
    float glow   = pow(facing, 2.2);

    // Slow, soft brightness variation along the thread: the light breathes, nothing travels.
    float shimmer = 0.78 + 0.22 * sin(vT * 7.0 - uTime * 0.5 + uPhase * 4.0);
    // Ease in out of the node glows, so threads emerge from the light.
    float ends    = smoothstep(0.0, 0.1, vT) * smoothstep(1.0, 0.9, vT);

    float s     = uStrength;
    float alpha = (core * (0.30 + 0.55 * s) + glow * (0.03 + 0.11 * s))
                * shimmer * (0.4 + 0.6 * ends);

    vec3 col = mix(uColorA, uColorB, vT);

    // Hover: the thread fills with the hovered node's light, strongest at that
    // node and easing off toward the far end. Weak threads are lifted too.
    float near = 1.0 - abs(vT - uHiEnd);                 // 1 at the hovered node
    float lift = uHi * (0.55 + 0.45 * near);
    col    = mix(col, uHiColor, uHi);
    alpha  = alpha * (1.0 + 1.6 * lift)
           + lift * (core * 0.30 + glow * 0.07) * (0.4 + 0.6 * ends);

    // Focus mode fades unrelated threads back; hovering one brings it forward again.
    alpha *= 1.0 - uDim * (1.0 - uHi);

    col      = mix(col, vec3(1.0), core * 0.55);   // white-hot centre line
    gl_FragColor = vec4(col, alpha);
  }
`;

// ── Colour ────────────────────────────────────────────────────────────────────
// Beam colour: the endpoint's course colour pulled 45% toward white. Cached per hex.
const beamColorCache = new Map<string, THREE.Color>();
function beamColor(domain: string | undefined): THREE.Color {
  const hex = colorOf(domain);
  let c = beamColorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), 0.45);
    beamColorCache.set(hex, c);
  }
  return c;
}

// Brighter than the resting beams: only 20% toward white, so the hue reads.
export function hoverColor(domain: string): THREE.Color {
  return new THREE.Color(colorOf(domain)).lerp(new THREE.Color("#ffffff"), 0.2);
}

// Cheap stable hash → 0..2π, so a link keeps its bow direction across reloads.
function linkPhase(link: SimLink): number {
  const key = idOf(link.source) + "|" + idOf(link.target);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

// ── Registry ──────────────────────────────────────────────────────────────────
// `end` is which end of the beam the registering node sits at: 0 = source, 1 = target.
export interface BeamEntry {
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  link: SimLink;
  end: number;
}
export const beamsByNode = new Map<string, Set<BeamEntry>>();

// The materials of every beam touching `nodeId`: what focus mode keeps lit.
export function litBeamsOf(nodeId: string | null): Set<THREE.ShaderMaterial> {
  const lit = new Set<THREE.ShaderMaterial>();
  if (nodeId) for (const { material } of beamsByNode.get(nodeId) ?? []) lit.add(material);
  return lit;
}

// The node at the far end of a beam, seen from the node that registered it.
export function beamDestination(entry: BeamEntry): SimNode | null {
  const other = entry.end === 0 ? entry.link.target : entry.link.source;
  return typeof other === "string" ? null : other;
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createBeam(link: SimLink): THREE.Object3D {
  const s = link.strength ?? 0.5;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: beamTime,
      uLen: { value: 1 },
      uPhase: { value: linkPhase(link) },
      uRadius: { value: 0.45 + Math.pow(s, 1.5) * 1.6 },
      uDrift: { value: beamDrift },
      uStrength: { value: s },
      uColorA: { value: beamColor(link.sourceDomain) },
      uColorB: { value: beamColor(link.targetDomain) },
      uHi: { value: 0 },
      uHiEnd: { value: 0 },
      uHiColor: { value: new THREE.Color() },
      uDim: { value: 0 },
    },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beamDim: Dimmable = { dim: 0, target: 0, apply: (d) => { material.uniforms.uDim!.value = d; } };
  beamDims.set(material, beamDim);
  const mesh = new THREE.Mesh(getBeamGeometry(), material);
  mesh.frustumCulled = false; // the drift moves it outside the unit tube's bounds
  mesh.raycast = () => {};    // never intercept taps

  // Register under both endpoints so hovering either one lights this beam.
  const src = idOf(link.source), tgt = idOf(link.target);
  const entries: [string, BeamEntry][] = [
    [src, { material, mesh, link, end: 0 }],
    [tgt, { material, mesh, link, end: 1 }],
  ];
  for (const [id, entry] of entries) {
    if (!beamsByNode.has(id)) beamsByNode.set(id, new Set());
    beamsByNode.get(id)!.add(entry);
  }
  material.addEventListener("dispose", () => {
    for (const [id, entry] of entries) {
      const set = beamsByNode.get(id);
      set?.delete(entry);
      if (set && set.size === 0) beamsByNode.delete(id);
    }
    fadingBeams.delete(material);
    activeDims.delete(beamDim);
    beamDims.delete(material);
    if (hoveredBeam?.material === material) hoveredBeam = null;
  });
  return mesh;
}

// Place the beam at the source, aim it at the target, stretch it to length.
const _beamEnd = new THREE.Vector3();
export function positionBeam(
  obj: THREE.Object3D,
  { start, end }: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } },
): boolean {
  obj.position.set(start.x, start.y || 0, start.z || 0);
  _beamEnd.set(end.x, end.y || 0, end.z || 0);
  const len = obj.position.distanceTo(_beamEnd);
  obj.scale.z = Math.max(len, 1e-3);
  obj.lookAt(_beamEnd);
  const m = (obj as THREE.Mesh).material as THREE.ShaderMaterial;
  if (m?.uniforms?.uLen) m.uniforms.uLen.value = len;
  return true; // fully handled; skip the library's own update
}

// ── Hover highlight ───────────────────────────────────────────────────────────
// Hovering a node lights every beam attached to it in that node's colour.
// Each beam's uHi eases toward its target in the frame loop, so it glows up and
// fades out rather than switching.
const fadingBeams = new Map<THREE.ShaderMaterial, number>(); // material → target uHi
const HOVER_FADE_IN_S = 0.18;
const HOVER_FADE_OUT_S = 0.45;
let hoveredId: string | null = null;

export function setHoveredNode(node: SimNode | null): void {
  const id = node?.id ?? null;
  if (id === hoveredId) return;
  if (hoveredId) {
    for (const { material } of beamsByNode.get(hoveredId) ?? []) fadingBeams.set(material, 0);
  }
  hoveredId = id;
  if (node) {
    const color = hoverColor(node.domain);
    for (const { material, end } of beamsByNode.get(node.id) ?? []) {
      (material.uniforms.uHiColor!.value as THREE.Color).copy(color);
      material.uniforms.uHiEnd!.value = end;
      fadingBeams.set(material, 1);
    }
  }
}

// Hovering a pickable beam lights it in the destination's colour, brightest at
// the destination, as a preview of where a click will take you.
let hoveredBeam: BeamEntry | null = null;

export function isBeamHovered(): boolean {
  return hoveredBeam !== null;
}

export function setHoveredBeam(entry: BeamEntry | null): void {
  if (entry === hoveredBeam) return;
  if (hoveredBeam) fadingBeams.set(hoveredBeam.material, 0);
  hoveredBeam = entry;
  // The pointer is usually inside the selected node's glow too; the beam wins.
  if (entry) setHoveredNode(null);
  const dest = entry && beamDestination(entry);
  if (entry && dest) {
    const u = entry.material.uniforms;
    (u.uHiColor!.value as THREE.Color).copy(hoverColor(dest.domain));
    u.uHiEnd!.value = 1 - entry.end;
    fadingBeams.set(entry.material, 1);
  }
}

export function stepHoverFades(dt: number): void {
  for (const [material, target] of fadingBeams) {
    const u = material.uniforms.uHi!;
    const rate = dt / (target > u.value ? HOVER_FADE_IN_S : HOVER_FADE_OUT_S);
    u.value = target > u.value ? Math.min(target, u.value + rate) : Math.max(target, u.value - rate);
    if (u.value === target) fadingBeams.delete(material);
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
// Called on unmount, after resetNodes(). The shared geometry and colour cache stay.
export function resetBeams(): void {
  beamsByNode.clear();
  fadingBeams.clear();
  hoveredId = null;
  hoveredBeam = null;
  beamTime.value = 0;
}
