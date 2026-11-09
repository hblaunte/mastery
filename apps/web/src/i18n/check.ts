// @ts-nocheck -- a Node script inside the web tree; the app tsconfig has no Node types.
// Finds every translation key used in apps/web/src and reports the ones missing from a dictionary.
// Run with:  npx tsx apps/web/src/i18n/check.ts
// Exit code 1 when anything is missing, so it can gate a build.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import zhHans from "./zh-Hans";
import zhHant from "./zh-Hant";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "i18n") walk(p, out); }
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

// t("…"), tx("…"), tr("…"), k("…"): the first argument, a double-quoted literal with JS escapes.
const CALL = /\b(?:t|tx|tr|k)\(\s*"((?:[^"\\\n]|\\.)*)"/g;

const keys = new Map<string, Set<string>>(); // key → files
for (const file of walk(srcRoot)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(CALL)) {
    let key: string;
    try { key = JSON.parse(`"${m[1]}"`) as string; } catch { key = m[1]!; }
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key)!.add(relative(srcRoot, file));
  }
}

const dicts: [string, Record<string, string>][] = [["zh-Hans", zhHans], ["zh-Hant", zhHant]];
let missing = 0;
for (const [name, dict] of dicts) {
  const absent = [...keys.keys()].filter((key) => !(key in dict)).sort();
  const empty = [...keys.keys()].filter((key) => key in dict && !dict[key]!.trim()).sort();
  const unused = Object.keys(dict).filter((key) => !keys.has(key)).sort();
  console.log(`${name}: ${Object.keys(dict).length} entries, ${absent.length} missing, ${empty.length} empty, ${unused.length} unused`);
  for (const key of absent) console.log(`  missing  ${JSON.stringify(key)}   ← ${[...keys.get(key)!].join(", ")}`);
  for (const key of empty) console.log(`  empty    ${JSON.stringify(key)}`);
  for (const key of unused) console.log(`  unused   ${JSON.stringify(key)}`);
  missing += absent.length + empty.length;
}
console.log(`${keys.size} keys in use across ${new Set([...keys.values()].flatMap((s) => [...s])).size} files`);
if (missing) process.exit(1);
