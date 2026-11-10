/**
 * Serve the built web app from an absolute directory, with the SPA fallback to index.html.
 * Hono's bundled static middleware resolves roots against the working directory, which is
 * arbitrary when the server runs inside a desktop shell launched from Finder or a shortcut.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { MiddlewareHandler } from "hono";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
};

export function serveDist(root: string): MiddlewareHandler {
  const abs = path.resolve(root);
  const index = path.join(abs, "index.html");
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    if (c.req.path.startsWith("/api/")) return next();
    let rel: string;
    try { rel = decodeURIComponent(c.req.path); } catch { return c.text("Bad path", 400); }
    const candidate = path.resolve(abs, "." + rel);
    // Stay inside the dist directory whatever the URL says.
    const inside = candidate === abs || candidate.startsWith(abs + path.sep);
    const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : index;
    if (!existsSync(file)) return next();
    const ext = path.extname(file).toLowerCase();
    const headers: Record<string, string> = { "Content-Type": MIME[ext] ?? "application/octet-stream" };
    // Vite hashes everything under assets/; the shell html must always be re-checked.
    headers["Cache-Control"] = file !== index && rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    headers["Content-Length"] = String(statSync(file).size);
    if (c.req.method === "HEAD") return new Response(null, { headers });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
  };
}
