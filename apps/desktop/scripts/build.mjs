// Bundle the server (ESM, self-contained) and the Electron main process (CJS), then stage the
// web build and the prompts under resources/ so electron-builder can pack them as extraResources.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..", "..");
const resources = path.join(desktop, "resources");

rmSync(resources, { recursive: true, force: true });
rmSync(path.join(desktop, "dist"), { recursive: true, force: true });
mkdirSync(path.join(resources, "server"), { recursive: true });

// CommonJS dependencies inside an ESM bundle still call require/__dirname; give them real ones.
const esmShim = `import { createRequire as __cr } from "node:module"; import { fileURLToPath as __f2p } from "node:url"; import { dirname as __dn } from "node:path";
const require = __cr(import.meta.url); const __filename = __f2p(import.meta.url); const __dirname = __dn(__filename);`;

await build({
  entryPoints: [path.join(root, "apps", "server", "src", "server.ts")],
  outfile: path.join(resources, "server", "server.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: true, minify: false,
  banner: { js: esmShim },
  logLevel: "info",
});

await build({
  entryPoints: [path.join(desktop, "src", "main.ts")],
  outfile: path.join(desktop, "dist", "main.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node22", sourcemap: true,
  external: ["electron"],
  logLevel: "info",
});

const webDist = path.join(root, "apps", "web", "dist");
if (!existsSync(path.join(webDist, "index.html"))) throw new Error("apps/web/dist is missing: run `pnpm --filter @mastery/web build` first");
cpSync(webDist, path.join(resources, "web"), { recursive: true, filter: (src) => !src.endsWith(".map") });
cpSync(path.join(root, "prompts"), path.join(resources, "prompts"), { recursive: true });
console.log("staged resources/{server,web,prompts}");
