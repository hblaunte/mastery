// Glass UI primitives, ported from the Helm Frontend Kit (see ATTRIBUTION.md): icons, status tone,
// avatars, sheets, the lens tab bar, toasts, the count roll and the theme preference.
// Styles: glass.css. No platform calls here.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hueOf, initialsOf } from "./index";

// ---- icons: inline stroke paths, 24×24 ----
const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  board: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z",
  wall: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z",
  plus: "M12 5v14M5 12h14",
  chart: "M5 20V11M12 20V5M19 20v-6",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "M9 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.6-3.6",
  verify: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8.5 12.2l2.4 2.4 4.6-4.8",
  pr: "M6 3.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM6 15.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM18 15.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM6 8.2v7.6M18 15.8V10a3 3 0 0 0-3-3h-3.5M13.5 4.5 11 7l2.5 2.5",
  merge: "M6 2.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM6 16.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM18 9.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM6 7.2v9.6M6 9c0 2.5 2.5 3 9.8 3",
  stop: "M8.5 6.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
  alert: "M12 3.5 2.8 19.5h18.4zM12 10v4M12 17h.01",
  message: "M4 5h16v11H9l-5 4z",
  phone: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  pause: "M9 6v12M15 6v12",
  play: "M8 5.5v13l10.5-6.5z",
  person: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5",
  archive: "M4 5h16v4H4zM5.5 9v10h13V9M10 13h4",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  plug: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5",
  diagnose: "M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.4-4.4M8.5 11h5M11 8.5v5",
  send: "M12 19V5M5 12l7-7 7 7",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5V5.5M8 7h8M8 10.5h8",
  graph: "M6 6a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 6 6zM18 4a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 18 4zM12 15.6a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM7.8 9.6l3.2 6M16.4 8l-3.4 7.6M8.2 8.2 15.8 6.2",
  study: "M12 4 3 8.5 12 13l9-4.5zM7 10.6V16c1.6 1.4 3.2 2 5 2s3.4-.6 5-2v-5.4M21 8.5V14",
  key: "M14 3a5 5 0 1 1-3.9 8.1L3 18.2V21h2.8l1-1h2l1-1v-2l1.3-1.3A5 5 0 0 1 14 3zM15 7h.01",
  upload: "M12 16V5M7 10l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2",
  file: "M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6",
  trash: "M5 7h14M9 7V4h6v3M8 7l.8 13h6.4L16 7",
  settings: "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  flame: "M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.6 1.4-3.5.2 1.4 1 2.2 1.8 2.5C10.6 8 11.4 5.5 12 3zM12 21a7 7 0 0 0 7-7c0-1.7-.5-3-1.3-4.2",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg className={`ico${small ? " sm" : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---- status ----
export type Tone = "working" | "needs" | "failed" | "done" | "queued";

export function StatusText({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`status st-${tone}`}><span className="ldot" aria-hidden="true" />{label}</span>;
}

/** Inline custom properties (hue, sheet width) typed once. */
export function vars(v: Record<string, string | number>): CSSProperties {
  return v as CSSProperties;
}

export function Avatar({ name, size, dot }: { name: string; size?: "sm" | "lg"; dot?: Tone }) {
  return (
    <span className={`av${size ? ` ${size}` : ""}`} style={vars({ "--hue": hueOf(name) })} aria-hidden="true">
      {initialsOf(name)}
      {dot && <span className={`sdot st-${dot}`} />}
    </span>
  );
}

export function CloseButton({ onClose, label = "Close" }: { onClose: () => void; label?: string }) {
  return (
    <button type="button" className="ibtn ctrl" aria-label={label} onClick={onClose}>
      <Icon name="close" small />
    </button>
  );
}

/** One bar per step: done, current (breathing), or ahead. Used for the session progress strip. */
export function StepTrack({ steps, index, compact, label }: { steps: string[]; index: number; compact?: boolean; label?: string }) {
  return (
    <ol className={`track${compact ? " compact" : ""}`} style={vars({ "--n": steps.length })} aria-label={label ?? `Step ${index + 1} of ${steps.length}`}>
      {steps.map((s, i) => (
        <li key={`${s}-${i}`} className={`tk${i < index ? " done" : i === index ? " cur" : ""}`}>
          <span className="tk-bar" aria-hidden="true" />
          <span className="tk-l">{s}</span>
        </li>
      ))}
    </ol>
  );
}

// ---- sheets ----
/** Open/close state with the 220 ms exit, and focus returned to whatever opened the sheet. */
export function useSheet<S>() {
  const [sheet, setSheet] = useState<S | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((s: S) => {
    window.clearTimeout(timer.current);
    if (!opener.current) opener.current = document.activeElement as HTMLElement | null;
    setClosing(false);
    setSheet(s);
  }, []);
  const close = useCallback(() => {
    setClosing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSheet(null);
      setClosing(false);
      opener.current?.focus?.({ preventScroll: true });
      opener.current = null;
    }, 220);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { sheet, closing, open, close };
}

interface SheetProps {
  labelledBy: string;
  closing: boolean;
  onClose: () => void;
  /** Course hue for a course sheet; omitted sheets show the blurred stage through a neutral veil. */
  hue?: number;
  width?: number;
  children: ReactNode;
}

/** Full-window sheet that blurs through over the stage (motion primitive 2). Escape closes it. */
export function Sheet({ labelledBy, closing, onClose, hue, width, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
    first?.focus({ preventScroll: true });
  }, []);
  // Escape closes the sheet wherever focus is: a sent reply disables its field and focus falls to <body>.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const style = hue === undefined ? undefined : vars({ "--hue": hue });
  return (
    <div
      ref={ref}
      className={`sheet${hue === undefined ? "" : " repo"}${closing ? " out" : ""}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
            <div className="sheet-in" style={width ? vars({ "--sheet-w": `${width}px` }) : undefined}>{children}</div>
    </div>
  );
}

// ---- tab bar ----
export interface GlassTab<T extends string> { id: T; label: string; icon: IconName; badge?: number; badgeLabel?: string; tour?: string }

/**
 * Floating glass tab bar. The lens slides on a spring and stretches mid-move (primitive 7);
 * its position comes from --i and the shell's --tab-w, so any number of tabs works.
 */
export function TabBar<T extends string>({ tabs, current, onChange, compact }: { tabs: GlassTab<T>[]; current: T; onChange: (t: T) => void; compact: boolean }) {
  const [stretch, setStretch] = useState<"" | "sA" | "sB">("");
  const idx = Math.max(0, tabs.findIndex((t) => t.id === current));
  return (
    <nav className={`tabbar lg${compact ? " compact" : ""}`} aria-label="Sections">
      <span className={`lens ${stretch}`} style={vars({ "--i": idx })} aria-hidden="true"><span className="lens-in" /></span>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className="tab"
          data-tour={t.tour}
          aria-current={t.id === current ? "page" : undefined}
          aria-label={t.badge ? t.badgeLabel ?? `${t.label}, ${t.badge}` : undefined}
          onClick={() => {
            if (t.id === current) return;
            setStretch((v) => (v === "sA" ? "sB" : "sA"));
            onChange(t.id);
          }}
        >
          <Icon name={t.icon} />
          <span className="lbl">{t.label}</span>
          {t.badge ? <span className="tbadge" aria-hidden="true">{t.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}

// ---- toast ----
export interface ToastMsg { text: string; key: number; error?: boolean }

/** One line confirming an action (primitive 6). A new toast replaces the current one.
 *  Errors stay up longer and show a warning mark instead of a tick. */
export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, opts?: { error?: boolean }) => {
    window.clearTimeout(timer.current);
    setToast({ text, key: Date.now(), error: opts?.error });
    timer.current = window.setTimeout(() => setToast(null), opts?.error ? 7000 : 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastMsg | null }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {toast && (
        <div key={toast.key} className={`toast lg${toast.error ? " error" : ""}`} data-testid="toast">
          <span className="tick"><Icon name={toast.error ? "alert" : "check"} small /></span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

// ---- count roll: alternate two identical keyframes so a change restarts the animation ----
export function useRoll(value: number): string {
  const [cls, setCls] = useState("");
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) setCls((c) => (c === "rollA" ? "rollB" : "rollA"));
    prev.current = value;
  }, [value]);
  return cls;
}

// ---- theme ----
export type ThemePref = "system" | "light" | "dark";
const THEME_KEY = "mastery.theme";

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** System follows the OS; Light and Dark pin it. Written to <html data-theme> so tokens.css switches. */
export function applyTheme(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === "system") delete el.dataset.theme;
  else el.dataset.theme = pref;
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  useEffect(() => {
    applyTheme(pref);
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* storage blocked: the choice lasts for this window */
    }
  }, [pref]);
  return [pref, setPref];
}

/** Hero drift while scrolling (primitive 4): slower than the content, fading by 190 px. */
export function heroStyle(scrollY: number): CSSProperties {
  const y = Math.min(scrollY, 400);
  return {
    transform: `translateY(${Math.round(y * 0.42)}px) scale(${(1 - (Math.min(y, 200) / 200) * 0.06).toFixed(3)})`,
    opacity: Math.max(0, 1 - y / 190),
    // The drift above lets the content below rise 0.42 px into the hero per px scrolled; cut the
    // hero off there so it never shows through the tinted cards passing over it.
    clipPath: y > 0 ? `inset(0 0 ${Math.round(y * 0.42)}px 0)` : undefined,
  };
}
