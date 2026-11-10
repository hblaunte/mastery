import path from "node:path";
import { REPO_ROOT, routingSummary } from "./config.js";
import { keyStatus } from "./keys.js";
import { startServer } from "./server.js";
import * as store from "./store.js";

const running = await startServer();
if (running.migrated) console.log(`  moved ${running.migrated} sources into data/library`);

const k = keyStatus();
console.log(`\nmastery  ->  ${running.url}`);
console.log(`  data: ${path.relative(REPO_ROOT, store.DATA_DIR_RESOLVED) || "."}`);
console.log(`  ${store.listSources().length} sources · ${store.listCourses().length} courses · ${store.listSessions().length} sessions`);
for (const [job, r] of Object.entries(routingSummary())) console.log(`  ${job.padEnd(12)} ${r}`);
console.log(k.mode === "none" ? "  ! no API key yet: add one in Settings" : `  key: ${k.mode}${k.last4 ? ` (…${k.last4})` : ""}`);
console.log("  ctrl-c to stop\n");
