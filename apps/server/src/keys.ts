/**
 * The learner's API key. Two modes:
 *   byok     the learner's own Anthropic key, stored encrypted at rest (AES-256-GCM) with a
 *            secret that lives only on this machine (data/.secret, mode 0600).
 *   managed  the operator's key from MASTERY_MANAGED_KEY, when offered.
 * In neither mode does a key ever reach the browser. The status endpoint returns the last four
 * characters of a BYO key, for recognition only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KeyMode, KeyStatus } from "@mastery/shared";
import { DATA_DIR, MANAGED_KEY } from "./config.js";
import { nowIso } from "./ids.js";

const SECRET = path.join(DATA_DIR, ".secret");
const VAULT = path.join(DATA_DIR, "key.json");

interface Vault { mode: KeyMode; iv?: string; tag?: string; data?: string; last4?: string; valid?: boolean; checkedAt?: string; error?: string }

function secret(): Buffer {
  if (!existsSync(SECRET)) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SECRET, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(SECRET, "utf8").trim(), "hex");
}

function readVault(): Vault {
  if (!existsSync(VAULT)) return { mode: "none" };
  try {
    return JSON.parse(readFileSync(VAULT, "utf8")) as Vault;
  } catch {
    return { mode: "none" };
  }
}
function writeVault(v: Vault): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(VAULT, JSON.stringify(v, null, 2), { mode: 0o600 });
}

function encrypt(plain: string): Pick<Vault, "iv" | "tag" | "data"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function decrypt(v: Vault): string | null {
  if (!v.iv || !v.tag || !v.data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", secret(), Buffer.from(v.iv, "base64"));
    d.setAuthTag(Buffer.from(v.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(v.data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function keyStatus(): KeyStatus {
  const v = readVault();
  const mode: KeyMode = v.mode === "managed" && !MANAGED_KEY ? "none" : v.mode;
  return {
    mode,
    last4: mode === "byok" ? v.last4 : undefined,
    valid: v.valid,
    checkedAt: v.checkedAt,
    error: v.error,
    managedAvailable: Boolean(MANAGED_KEY),
  };
}

/** The key the server should use right now, or null. */
export function resolveKey(): string | null {
  const v = readVault();
  if (v.mode === "managed") return MANAGED_KEY;
  if (v.mode === "byok") return decrypt(v);
  return null;
}

export async function setKey(input: { mode: KeyMode; key?: string }): Promise<KeyStatus> {
  if (input.mode === "none") {
    rmSync(VAULT, { force: true });
    return keyStatus();
  }
  if (input.mode === "managed") {
    if (!MANAGED_KEY) throw new KeyError("No managed key is configured on this server.");
    writeVault({ mode: "managed" });
    return validateKey();
  }
  const key = (input.key ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new KeyError("That does not look like an Anthropic API key. Keys start with sk-ant-.");
  }
  writeVault({ mode: "byok", ...encrypt(key), last4: key.slice(-4) });
  return validateKey();
}

/** One cheap, free request to confirm the key is accepted. */
export async function validateKey(): Promise<KeyStatus> {
  const v = readVault();
  const key = resolveKey();
  if (!key) return keyStatus();
  try {
    await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
    writeVault({ ...v, valid: true, checkedAt: nowIso(), error: undefined });
  } catch (err) {
    const msg =
      err instanceof Anthropic.AuthenticationError ? "Anthropic rejected this key."
      : err instanceof Anthropic.PermissionDeniedError ? "This key is not allowed to use the API."
      : err instanceof Anthropic.APIConnectionError ? "Could not reach the Anthropic API."
      : err instanceof Error ? err.message : String(err);
    writeVault({ ...v, valid: false, checkedAt: nowIso(), error: msg });
  }
  return keyStatus();
}

export class KeyError extends Error {}
