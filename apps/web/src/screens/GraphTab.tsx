import { useEffect, useRef, useState } from "react";
import type { AppState, GraphData, GraphNode } from "@mastery/shared";
import { hueOf } from "@mastery/ui";
import { api } from "../api";
import { KnowledgeGraph } from "../graph";
import { Spinner } from "../components/bits";
import { useT } from "../i18n";

/** Course hue → a hex colour the three.js materials can take. Light enough to glow on the void. */
export function courseColor(id: string, title?: string): string {
  return hslToHex(hueOf(title ?? id), 0.62, 0.66);
}
function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function GraphTab({ theme, state, onStudy }: { theme: "light" | "dark" | "system"; state: AppState | null; onStudy: (courseId: string) => void }) {
  const { t } = useT();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    api.graph().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [state?.sessionsDone, state?.graph.nodes]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const titles = new Map((state?.courses ?? []).map((c) => [c.id, c.title]));
  const resolved: "light" | "dark" =
    theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div ref={wrap} className="graph-wrap">
      {error && <div className="narrow" style={{ paddingBlockStart: 80 }}><p className="form-error" role="alert">{error}</p></div>}
      {!data && !error && <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner label={t("Mapping what you know…")} /></div>}
      {data && size.w > 0 && (
        <KnowledgeGraph
          data={data}
          width={size.w}
          height={size.h}
          theme={resolved}
          colorFor={(id) => courseColor(id, titles.get(id))}
          onStudy={(node: GraphNode) => onStudy(node.domain)}
          reducedMotion={reduced}
        />
      )}
    </div>
  );
}
