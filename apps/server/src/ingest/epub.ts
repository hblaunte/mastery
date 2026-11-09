/**
 * EPUB → Markdown. container.xml → OPF → spine order → each XHTML item through htmlToText.
 * Every kept spine item starts with a [[section N]] marker and a heading.
 */
import type { Extracted } from "./extract.js";
import { unitMarker } from "./chunk.js";
import { htmlToText } from "./html.js";
import { attr, findAll, findFirst, openTag, openZip, resolvePath, textOf, zipText } from "./zip.js";

const MIN_NAV_CHARS = 200;

export function extractEpub(bytes: Uint8Array, fail: (warning: string) => Extracted, fallbackTitle: string): Extracted {
  const zip = openZip(bytes);
  if (!zip) return fail("This file is not a valid EPUB (the archive could not be opened).");

  const container = zipText(zip, "META-INF/container.xml");
  const rootfile = container ? findFirst(container, "rootfile") : undefined;
  let opfPath = rootfile ? attr(openTag(rootfile), "full-path") : undefined;
  if (!opfPath) {
    // Tolerate a missing container.xml: look for the one .opf in the archive.
    opfPath = Object.keys(zip).find((k) => k.toLowerCase().endsWith(".opf"));
  }
  const opf = opfPath ? zipText(zip, opfPath) : undefined;
  if (!opfPath || !opf) return fail("This EPUB has no package file (content.opf), so its chapters cannot be found. It may be damaged.");

  const title = textOf(opf, "dc:title").replace(/\s+/g, " ").trim() || undefined;

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of findAll(opf, "item")) {
    const tag = openTag(item);
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (!id || !href) continue;
    manifest.set(id, { href: resolvePath(opfPath, href), type: (attr(tag, "media-type") ?? "").toLowerCase(), props: (attr(tag, "properties") ?? "").toLowerCase() });
  }

  let refs = findAll(opf, "itemref").map((r) => attr(openTag(r), "idref")).filter((x): x is string => Boolean(x));
  if (!refs.length) {
    // No spine: fall back to every (x)html item in manifest order.
    refs = [...manifest.entries()].filter(([, m]) => /html/.test(m.type)).map(([id]) => id);
  }

  const parts: string[] = [];
  let section = 0;
  for (const idref of refs) {
    const item = manifest.get(idref);
    if (!item) continue;
    if (item.type && !/html|xml/.test(item.type)) continue;
    const html = zipText(zip, item.href);
    if (!html) continue;
    const { title: itemTitle, text } = htmlToText(html);
    if (!text) continue;
    const looksLikeNav = /\bnav\b/.test(item.props) || /\b(nav|toc|cover|titlepage|title-page|copyright|colophon)\b/i.test(`${idref} ${item.href}`) || /\bcover\b/i.test(item.props);
    if (looksLikeNav && text.length < MIN_NAV_CHARS) continue;
    section += 1;
    let body = text;
    if (!/^#{1,6}\s/m.test(body.split("\n\n")[0] ?? "")) {
      const heading = itemTitle && itemTitle !== title ? itemTitle : undefined;
      body = heading ? `## ${heading}\n\n${body}` : body;
    }
    parts.push(unitMarker("section", section).trim(), body);
  }

  if (!parts.length) return fail("No readable chapters were found in this EPUB. It may contain only images.");
  return { title: title ?? fallbackTitle, kind: "epub", text: parts.join("\n\n"), method: "text" };
}
