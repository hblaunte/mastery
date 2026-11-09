// Mastery UI helpers shared by the web app: hues, initials, counts, ages.

/** Stable hue for a course, derived from its name, so cards are identifiable at a glance. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Two-letter avatar: first letters of the first two words, else the first two letters. */
export function initialsOf(name: string): string {
  const words = name.split(/[-_ ./:]/).filter((w) => /^[a-z0-9]/i.test(w));
  if (words.length >= 2) return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
  const w = words[0] ?? name;
  return w.slice(0, 1).toUpperCase() + w.slice(1, 2).toLowerCase();
}

/**
 * One whole message per plural category, chosen by the locale's rules, with the number
 * formatted for the locale. Never assemble "n + noun + s".
 */
export function formatCount(n: number, forms: { one: string; other: string }, locale = "en"): string {
  const rules = new Intl.PluralRules(locale);
  const num = new Intl.NumberFormat(locale).format(n);
  const form = rules.select(n) === "one" ? forms.one : forms.other;
  return form.replace("{n}", num);
}

/** First `max` characters of a text on a word boundary where possible, with an ellipsis. */
export function excerpt(text: string, max = 240): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max);
  return `${t.slice(0, cut > max * 0.6 ? cut : max).trimEnd()}…`;
}

/** Compact age for lists: "now", "4m", "2h", "3d". */
export function shortAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** Score band used everywhere a score is coloured: 75 and up is good, 50 and up is middling. */
export function scoreBand(n: number | null | undefined): "good" | "mid" | "bad" | "none" {
  if (n == null) return "none";
  return n >= 75 ? "good" : n >= 50 ? "mid" : "bad";
}
