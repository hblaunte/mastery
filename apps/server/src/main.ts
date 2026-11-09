import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import path from "node:path";
import { PORT, REPO_ROOT, WEB_DIST, routingSummary } from "./config.js";
import { app } from "./app.js";
import { keyStatus } from "./keys.js";
import * as store from "./store.js";

store.ensureDirs();

// In production the built web app is served from the same origin; in development Vite proxies /api.
if (existsSync(WEB_DIST)) {
  const root = path.relative(process.cwd(), WEB_DIST) || ".";
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  const k = keyStatus();
  console.log(`\nmastery  ->  http://127.0.0.1:${PORT}`);
  console.log(`  data: ${path.relative(REPO_ROOT, store.DATA_DIR_RESOLVED)}`);
  console.log(`  ${store.listSources().length} sources · ${store.listCourses().length} courses · ${store.listSessions().length} sessions`);
  for (const [job, r] of Object.entries(routingSummary())) console.log(`  ${job.padEnd(12)} ${r}`);
  console.log(k.mode === "none" ? "  ! no API key yet: add one in Settings" : `  key: ${k.mode}${k.last4 ? ` (…${k.last4})` : ""}`);
  console.log("  ctrl-c to stop\n");
});
