import { useEffect, useRef, useState } from "react";
import type { Source, SourceChunk } from "@mastery/shared";
import { CloseButton } from "@mastery/ui/glass";
import { api } from "../api";
import { Spinner } from "../components/bits";

/** The in-app reader. Opened from a reading suggestion, it lands on the exact passage. */
export function ReaderSheet({ sourceId, chunk, sources, onClose }: { sourceId: string; chunk?: number; sources: Source[]; onClose: () => void }) {
  const source = sources.find((s) => s.id === sourceId);
  const [chunks, setChunks] = useState<SourceChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hit = useRef<HTMLElement>(null);
  useEffect(() => { api.chunks(sourceId).then((r) => setChunks(r.chunks)).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [sourceId]);
  useEffect(() => { if (chunks && hit.current) hit.current.scrollIntoView({ block: "start" }); }, [chunks]);
  return (
    <>
      <div className="sheet-bar"><CloseButton onClose={onClose} /></div>
      <h2 className="sheet-title" id="reader-title">{source?.title ?? "Source"}</h2>
      {source && <p className="lede">{source.origin}{source.pages ? ` · ${source.pages} pages` : ""} · {source.chunks} passages</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!chunks && !error && <Spinner label="Opening…" />}
      {chunks && (
        <div className="doc">
          {chunks.map((c) => (
            <section key={c.index} ref={c.index === chunk ? hit : undefined} className={`glass doc-chunk${c.index === chunk ? " hit" : ""}`} aria-label={c.locator}>
              <span className="hint">{c.locator}</span>
              <p>{c.text}</p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
