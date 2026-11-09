// Tiny i18n for the web app. The English source string is the key; a missing entry falls back to
// the key itself, so English never needs a dictionary. Placeholders are written {name}.

import { createContext, createElement, Fragment, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Language } from "@mastery/shared";
import zhHans from "./zh-Hans";
import zhHant from "./zh-Hant";

export type Lang = "en" | "zh-Hans" | "zh-Hant";
export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

/** BCP-47 tags handed to Intl. */
export const LOCALES: Record<Lang, string> = { en: "en", "zh-Hans": "zh-Hans-CN", "zh-Hant": "zh-Hant-TW" };

const DICTS: Record<Lang, Record<string, string> | null> = { en: null, "zh-Hans": zhHans, "zh-Hant": zhHant };

/** Marks a string literal as a translation key that is looked up later (data tables, step copy). */
export const k = (s: string): string => s;

/** Map a browser language tag to one of ours: zh-TW, zh-HK, zh-MO and any zh-Hant* are Traditional, other zh is Simplified. */
export function langFromTag(tag: string | undefined | null): Lang {
  const low = (tag ?? "").toLowerCase();
  if (!low.startsWith("zh")) return "en";
  if (/^zh(-hant|-tw|-hk|-mo)(-|$)/.test(low) || /-hant(-|$)/.test(low)) return "zh-Hant";
  return "zh-Hans";
}

export function resolveLang(setting: Language | undefined): Lang {
  if (setting === "en" || setting === "zh-Hans" || setting === "zh-Hant") return setting;
  const nav = typeof navigator !== "undefined" ? navigator.language : undefined;
  return langFromTag(nav);
}

function fill(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** A key may carry a context after "||" ("Light||depth") when one English word has two meanings; English drops it. */
const strip = (key: string): string => key.replace(/\|\|.*$/, "");

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const d = DICTS[lang];
  return fill((d && d[key]) ?? strip(key), vars);
}

/** Template with React nodes in the placeholders, for text that wraps markup ("lit <time>…</time>"). */
export function translateNodes(lang: Lang, key: string, vars: Record<string, ReactNode>): ReactNode[] {
  const d = DICTS[lang];
  const parts = ((d && d[key]) ?? strip(key)).split(/\{(\w+)\}/g);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p;
    return createElement(Fragment, { key: `${p}-${i}` }, p in vars ? vars[p] : `{${p}}`);
  }).filter((p) => p !== "");
}

// ---------------------------------------------------------------- active language, for code outside React

let active: Lang = "en";
/** Translate with the language the provider last rendered. For module-level code (tooltips, the API client). */
export const tr: T = (key, vars) => translate(active, key, vars);
export const activeLang = (): Lang => active;
export const activeLocale = (): string => LOCALES[active];

// ---------------------------------------------------------------- React

const Ctx = createContext<Lang>("en");

export function LangProvider({ setting, children }: { setting: Language | undefined; children: ReactNode }) {
  const lang = useMemo(() => resolveLang(setting ?? "auto"), [setting]);
  // Set during render too, so helpers called by children in this same pass already see the new language.
  active = lang;
  useEffect(() => {
    active = lang;
    document.documentElement.lang = lang;
  }, [lang]);
  return createElement(Ctx.Provider, { value: lang }, children);
}

export function useLang(): Lang {
  return useContext(Ctx);
}

export function useLocale(): string {
  return LOCALES[useContext(Ctx)];
}

export function useT() {
  const lang = useContext(Ctx);
  return useMemo(() => {
    const t: T = (key, vars) => translate(lang, key, vars);
    const tx = (key: string, vars: Record<string, ReactNode>): ReactNode[] => translateNodes(lang, key, vars);
    return { t, tx, lang, locale: LOCALES[lang] };
  }, [lang]);
}

// ---------------------------------------------------------------- dates and ages

/** Short date for lists: "Mar 5" / "3月5日". */
export function fmtDate(iso: string | null | undefined, locale: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  try {
    return new Date(t).toLocaleDateString(locale, opts);
  } catch {
    return new Date(t).toLocaleDateString(undefined, opts);
  }
}

/** Compact relative age for lists: "now", "4m ago", "2h ago", "3d ago" / "现在", "4分钟前", "3天前". */
export function relativeAge(iso: string | null | undefined, locale: string, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });
  }
  if (s < 45) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86_400), "day");
}

/** "+12" / "-4" / "0": a signed integer for bias readouts. */
export function signed(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : ""}${r}`;
}
