import { useEffect, useId, useRef, useState } from "react";

/**
 * Detented confidence picker. A range input invites a shrug at the midpoint; a flat 75 across a
 * whole session makes resolution undefined, since a predictor with no variance has no correlation
 * to compute. Detents make each value a stop you chose, and the verbal anchors give the numbers
 * meaning so the range actually gets used. Built on native scroll-snap.
 */
const STEP = 5;
const STOPS = Array.from({ length: 100 / STEP + 1 }, (_, i) => i * STEP);

export function caption(v: number): string {
  return v <= 15 ? "almost certainly not" : v <= 35 ? "probably not" : v <= 60 ? "genuinely unsure" : v <= 80 ? "probably" : "almost certain";
}

export function ConfidencePicker({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [touched, setTouched] = useState(value !== null);
  const [shown, setShown] = useState(value ?? 50);
  const ready = useRef(false);
  const stopW = useRef(34);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(".picker-stop");
    stopW.current = first?.getBoundingClientRect().width || 34;
    const pad = Math.max(0, (el.clientWidth - stopW.current) / 2);
    el.style.paddingLeft = el.style.paddingRight = `${pad}px`;
    el.scrollTo({ left: ((value ?? 50) / STEP) * stopW.current });
    // The programmatic scroll above fires a scroll event; ignore it, or the picker would count
    // itself as touched before anything moved.
    const t = requestAnimationFrame(() => requestAnimationFrame(() => { ready.current = true; }));
    return () => cancelAnimationFrame(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (v: number) => { setTouched(true); setShown(v); onChange(v); };
  const valueNow = () => Math.min(STOPS.length - 1, Math.max(0, Math.round((track.current?.scrollLeft ?? 0) / stopW.current))) * STEP;
  const goTo = (v: number) => track.current?.scrollTo({ left: (v / STEP) * stopW.current, behavior: "smooth" });

  let frame = 0;
  const onScroll = () => {
    if (!ready.current) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => commit(valueNow()));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const delta = ({ ArrowLeft: -STEP, ArrowRight: STEP, PageDown: -25, PageUp: 25, Home: -100, End: 100 } as Record<string, number>)[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    ready.current = true;
    const next = Math.min(100, Math.max(0, (touched ? valueNow() : shown) + delta));
    goTo(next);
    commit(next);
  };

  return (
    <div className={`picker${touched ? "" : " untouched"}`}>
      <div className="picker-readout" aria-live="polite" id={`${id}-out`}>
        <span>{touched ? shown : "—"}</span>
        <small>{touched ? "%" : ""}</small>
      </div>
      <div className="picker-caption">{touched ? caption(shown) : "drag, click a stop, or use ← →"}</div>
      <div
        ref={track}
        className="picker-track"
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={touched ? shown : 50}
        aria-valuetext={touched ? `${shown} percent, ${caption(shown)}` : "not set"}
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {STOPS.map((v) => (
          <button
            key={v}
            type="button"
            className="picker-stop"
            data-major={v % 25 === 0 ? "" : undefined}
            aria-current={touched && v === shown ? "true" : undefined}
            tabIndex={-1}
            aria-label={`${v} percent`}
            onClick={() => { ready.current = true; goTo(v); commit(v); }}
          >
            <i /><b>{v}</b>
          </button>
        ))}
      </div>
      <div className="picker-needle" aria-hidden="true" />
    </div>
  );
}
