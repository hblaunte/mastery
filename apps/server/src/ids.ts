import { randomBytes } from "node:crypto";

/** Short, URL-safe, prefixed ids: "src_3f9a1c", "crs_…", "itm_…". */
export function newId(prefix: string, bytes = 5): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
