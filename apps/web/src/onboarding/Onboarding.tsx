// Guided first-run tour: a dim scrim with a rounded spotlight cut around a [data-tour] anchor on the
// stage, and a glass card beside it. The stage is never interactive while the tour is up.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import type { AppState } from "@mastery/shared";
import { Icon } from "@mastery/ui/glass";
import { Demo, ONBOARDING_STEPS, finalAction, tailoredBody, type TourSheet, type TourTab } from "./steps";
import "./onboarding.css";

export interface OnboardingProps {
  open: boolean;
  /** completed=true when the learner reaches the end, false when they skip or press Escape. */
  onClose: (completed: boolean) => void;
  /** Live app state, to tailor copy and the final CTAs. May be null while loading. */
  state: AppState | null;
  /** Switch the tab on the stage behind the overlay before a step measures its anchor. */
  go: (tab: TourTab) => void;
  /** Open a sheet on the stage (used only by the final step's CTAs). */
  openSheet: (kind: TourSheet) => void;
}

interface Box { x: number; y: number; w: number; h: number }
interface View { w: number; h: number }

const PAD = 8; // spotlight padding around the anchor
const GUTTER = 16; // card distance from the viewport edge
const GAP = 14; // card distance from the spotlight
const FIND_MS = 300; // how long an anchor may take to appear after go(tab)
const EXIT_MS = 220;
const PHONE = 640;

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function anchorEl(anchor: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? el : null;
}

function measure(el: HTMLElement, view: View): Box | null {
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  // Spotlight in viewport coordinates, padded, kept on screen.
  const x = Math.max(4, Math.round(r.left - PAD));
  const y = Math.max(4, Math.round(r.top - PAD));
  const right = Math.min(view.w - 4, Math.round(r.right + PAD));
  const bottom = Math.min(view.h - 4, Math.round(r.bottom + PAD));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Card position: below the spotlight, above when it does not fit, clamped to the viewport. */
function placeCard(hole: Box | null, view: View, card: { w: number; h: number }): { x: number; y: number } {
  if (!hole) return { x: Math.round((view.w - card.w) / 2), y: Math.round(Math.max(GUTTER, (view.h - card.h) / 2)) };
  const below = hole.y + hole.h + GAP;
  const above = hole.y - GAP - card.h;
  let y: number;
  if (below + card.h <= view.h - GUTTER) y = below;
  else if (above >= GUTTER) y = above;
  else {
    // Neither side fits: beside the spotlight if there is width, else on the roomier side, clamped.
    const roomBelow = view.h - (hole.y + hole.h);
    y = roomBelow >= hole.y ? below : above;
  }
  y = Math.min(Math.max(GUTTER, y), Math.max(GUTTER, view.h - GUTTER - card.h));
  let x = hole.x + hole.w / 2 - card.w / 2;
  x = Math.min(Math.max(GUTTER, x), Math.max(GUTTER, view.w - GUTTER - card.w));
  return { x: Math.round(x), y: Math.round(y) };
}

export function Onboarding({ open, onClose, state, go, openSheet }: OnboardingProps): JSX.Element | null {
  const steps = ONBOARDING_STEPS;
  const total = steps.length;
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [view, setView] = useState<View>(() => ({
    w: typeof window === "undefined" ? 1024 : window.innerWidth,
    h: typeof window === "undefined" ? 768 : window.innerHeight,
  }));
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const [closing, setClosing] = useState(false);
  // The card glides between steps, but not on its first placement (it would fly in from the corner).
  const [settled, setSettled] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const exitTimer = useRef<number | undefined>(undefined);
  const goRef = useRef(go);
  goRef.current = go;

  const step = steps[Math.min(index, total - 1)] ?? steps[0]!;
  const last = index === total - 1;
  const phone = view.w < PHONE;

  // ---- open / close lifecycle: reset, remember focus, give it back ----
  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreFocus.current = true;
    setIndex(0);
    setClosing(false);
    setHole(null);
    setCardPos(null);
    setSettled(false);
    return () => {
      window.clearTimeout(exitTimer.current);
      target.current = null;
      if (restoreFocus.current) prevFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // ---- step change: switch the tab, wait two frames, look for the anchor for up to 300 ms ----
  useEffect(() => {
    if (!open) return;
    target.current = null;
    if (!step.anchor) {
      setHole(null);
      return;
    }
    if (step.tab) goRef.current(step.tab);
    let cancelled = false;
    let raf = 0;
    const started = performance.now();
    const anchor = step.anchor;
    let frames = 0;
    const look = () => {
      if (cancelled) return;
      frames += 1;
      if (frames > 2) {
        const el = anchorEl(anchor);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) {
            el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
          }
          target.current = el;
          return;
        }
        if (performance.now() - started > FIND_MS) {
          setHole(null);
          return;
        }
      }
      raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [open, index, step.anchor, step.tab]);

  // ---- follow the anchor and the viewport: one rect read per frame, state only on change ----
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let lastView: View = { w: window.innerWidth, h: window.innerHeight };
    let lastHole: Box | null = null;
    const tick = () => {
      const v = { w: window.innerWidth, h: window.innerHeight };
      if (v.w !== lastView.w || v.h !== lastView.h) {
        lastView = v;
        setView(v);
      }
      const el = target.current;
      if (el) {
        const b = measure(el, v);
        if (!b) {
          target.current = null;
          lastHole = null;
          setHole(null);
        } else if (!sameBox(b, lastHole)) {
          lastHole = b;
          setHole(b);
        }
      } else {
        lastHole = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // ---- place the card once its new height is known ----
  useLayoutEffect(() => {
    if (!open || phone) return;
    const card = cardRef.current;
    if (!card) return;
    const next = placeCard(hole, view, { w: card.offsetWidth, h: card.offsetHeight });
    setCardPos((p) => (p && p.x === next.x && p.y === next.y ? p : next));
  });

  useEffect(() => {
    if (!cardPos || settled) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [cardPos, settled]);

  // ---- focus: the primary button on open and on each step ----
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => primaryRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open, index]);

  // ---- closing with the 220 ms exit ----
  const finish = useCallback(
    (completed: boolean, after?: () => void) => {
      if (closing) return;
      const done = () => {
        after?.();
        onClose(completed);
      };
      if (prefersReducedMotion()) return done();
      setClosing(true);
      window.clearTimeout(exitTimer.current);
      exitTimer.current = window.setTimeout(done, EXIT_MS);
    },
    [closing, onClose],
  );

  const next = useCallback(() => {
    if (last) finish(true);
    else setIndex((i) => Math.min(total - 1, i + 1));
  }, [finish, last, total]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const skip = useCallback(() => finish(false), [finish]);

  const action = finalAction(state);
  const runAction = useCallback(() => {
    if (!action) return finish(true);
    if (action.kind === "begin") {
      finish(true, () => goRef.current("home"));
      return;
    }
    // The sheet takes focus when it mounts; hand focus back first so the sheet returns it there.
    restoreFocus.current = false;
    finish(true, () => {
      prevFocus.current?.focus?.({ preventScroll: true });
      openSheet(action.sheet);
    });
  }, [action, finish, openSheet]);

  // ---- keyboard: arrows and Enter step, Escape skips, Tab stays in the card ----
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        skip();
        return;
      }
      if (e.key === "Tab") {
        const card = cardRef.current;
        if (!card) return;
        const items = Array.from(card.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
        const first = items[0];
        const lastItem = items[items.length - 1];
        if (!first || !lastItem) return;
        const active = document.activeElement;
        if (!card.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && active === lastItem) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onButton = document.activeElement instanceof HTMLButtonElement && cardRef.current?.contains(document.activeElement);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (!last) next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        back();
      } else if (e.key === "Enter" && !onButton) {
        // A focused button handles Enter itself.
        e.preventDefault();
        e.stopPropagation();
        next();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, last, next, back, skip]);

  // Focus that escapes the card (a click on the scrim, a programmatic focus on the stage) comes back.
  useEffect(() => {
    if (!open) return;
    const onFocus = (e: FocusEvent) => {
      const card = cardRef.current;
      if (card && e.target instanceof Node && !card.contains(e.target)) primaryRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const shown = hole && step.anchor ? hole : null;
  const spot: CSSProperties = shown
    ? { transform: `translate(${shown.x}px, ${shown.y}px)`, width: shown.w, height: shown.h }
    : { transform: `translate(${Math.round(view.w / 2)}px, ${Math.round(view.h / 2)}px)`, width: 0, height: 0 };

  // Phone: dock to the bottom, or to the top when the spotlight sits in the lower part of the screen.
  const dockTop = phone && !!shown && shown.y + shown.h > view.h * 0.55;
  const cardStyle: CSSProperties | undefined = phone
    ? undefined
    : cardPos
      ? { transform: `translate(${cardPos.x}px, ${cardPos.y}px)` }
      : { visibility: "hidden" };

  const titleId = "ob-title";
  const bodyId = "ob-body";
  const body = tailoredBody(step, state);

  return createPortal(
    <div className={`ob${closing ? " out" : ""}`} data-step={step.id}>
      {/* Clicks never reach the stage; on the last step only the spotlight lets them through. */}
      {last && shown ? (
        <>
          <div className="ob-block" style={{ inset: `0 0 auto 0`, height: shown.y }} />
          <div className="ob-block" style={{ inset: `${shown.y + shown.h}px 0 0 0` }} />
          <div className="ob-block" style={{ top: shown.y, height: shown.h, left: 0, width: shown.x }} />
          <div className="ob-block" style={{ top: shown.y, height: shown.h, left: shown.x + shown.w, right: 0 }} />
        </>
      ) : (
        <div className="ob-block" style={{ inset: 0 }} />
      )}
      <div className={`ob-spot${shown ? " on" : ""}`} style={spot} aria-hidden="true" />

      <div
        ref={cardRef}
        className={`glass ob-card${settled ? " moves" : ""}${phone ? (dockTop ? " docked top" : " docked") : ""}`}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="ob-content" key={step.id}>
          <span className="ob-over">Step {index + 1} of {total}</span>
          <h2 id={titleId} className="ob-title">{step.title}</h2>
          <p id={bodyId} className="ob-body">{body}</p>
          {step.demo && <Demo kind={step.demo} />}
        </div>

        <div className="ob-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className={`ob-dot-i${i === index ? " cur" : i < index ? " done" : ""}`} />
          ))}
        </div>

        <div className="ob-actions">
          {!last && (
            <button type="button" className="ob-skip" onClick={skip}>
              Skip tour
            </button>
          )}
          <span className="grow" />
          {index > 0 && (
            <button type="button" className="cta ghost auto small" onClick={back}>
              Back
            </button>
          )}
          {last ? (
            action ? (
              <>
                <button type="button" className="cta ghost auto small" onClick={() => finish(true)}>
                  Finish
                </button>
                <button ref={primaryRef} type="button" className="cta auto small" onClick={runAction}>
                  {action.label}
                  <Icon name="chevron" small />
                </button>
              </>
            ) : (
              <button ref={primaryRef} type="button" className="cta auto small" onClick={() => finish(true)}>
                Finish
              </button>
            )
          ) : (
            <button ref={primaryRef} type="button" className="cta auto small" onClick={next}>
              Next
              <Icon name="chevron" small />
            </button>
          )}
        </div>

        <span className="visually-hidden" aria-live="polite" aria-atomic="true">
          Step {index + 1} of {total}: {step.title}
        </span>
      </div>
    </div>,
    document.body,
  );
}
