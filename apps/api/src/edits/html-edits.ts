import * as cheerio from 'cheerio';

/** Element ids as ABA writes them (data-aba-id): letters, digits, "_" and "-". */
export const ELEMENT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** A problem the user should see, e.g. "That element no longer exists". */
export class EditError extends Error {}

function load(html: string) {
  return cheerio.load(html);
}

function byId($: cheerio.CheerioAPI, id: string) {
  if (!ELEMENT_ID_RE.test(id)) throw new EditError('That is not a valid element id.');
  return $(`[data-aba-id="${id}"]`).first();
}

/** The element's HTML (with its children), or null if it is not on the page. */
export function extractElement(html: string, id: string): string | null {
  const $ = load(html);
  const el = byId($, id);
  return el.length ? $.html(el) : null;
}

/**
 * Checks Hermes' answer for aba-edit-element: one JSON object {"html", "css"} whose html is
 * exactly one root element that keeps the same data-aba-id. A stray ```json fence is removed.
 */
export function parseEditReply(reply: string, id: string): { html: string; css: string } {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new EditError('The answer was not JSON.');
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new EditError('The answer was not valid JSON.');
  }
  const { html, css } = (data ?? {}) as { html?: unknown; css?: unknown };
  if (typeof html !== 'string' || !html.trim()) throw new EditError('The answer had no "html".');
  if (css !== undefined && typeof css !== 'string') throw new EditError('"css" was not text.');

  const $ = cheerio.load(html, null, false);
  const roots = $.root()
    .contents()
    .filter((_, n) => n.type === 'tag' || (n.type === 'text' && $(n).text().trim() !== ''));
  if (roots.length !== 1 || roots[0].type !== 'tag') {
    throw new EditError('The answer must be exactly one element.');
  }
  if ($(roots[0]).attr('data-aba-id') !== id) {
    throw new EditError(`The answer must keep data-aba-id="${id}".`);
  }
  if ($('script, iframe, object, embed').length || $.root().find('script').length) {
    throw new EditError('The answer may not add scripts or embedded frames.');
  }
  return { html: $.html(roots[0]), css: (css ?? '').trim() };
}

/** Replaces one element (found by its data-aba-id) and leaves everything else untouched. */
export function replaceElement(pageHtml: string, id: string, newHtml: string): string {
  const $ = load(pageHtml);
  const el = byId($, id);
  if (!el.length) throw new EditError('That element no longer exists. Reload the preview and try again.');
  el.replaceWith(newHtml);
  return $.html();
}

/**
 * Moves one element: into `parentId` (null = <body>), before `beforeId` (null = at the end).
 * Refuses drops into the element itself or one of its own children.
 */
export function moveElement(
  pageHtml: string,
  id: string,
  parentId: string | null,
  beforeId: string | null,
): string {
  const $ = load(pageHtml);
  const el = byId($, id);
  if (!el.length) throw new EditError('That element no longer exists. Reload the preview and try again.');
  const parent = parentId ? byId($, parentId) : $('body');
  if (!parent.length) throw new EditError('The place you dropped it no longer exists.');
  if (parentId === id || (parentId && el.find(`[data-aba-id="${parentId}"]`).length)) {
    throw new EditError('An element cannot be moved inside itself.');
  }
  if (beforeId) {
    if (beforeId === id) throw new EditError('An element cannot be moved before itself.');
    const before = parent.children(`[data-aba-id="${beforeId}"]`).first();
    if (!before.length) throw new EditError('The place you dropped it no longer exists.');
    el.insertBefore(before);
  } else {
    parent.append(el);
  }
  return $.html();
}

const offsetLine = (id: string, left: number, top: number) =>
  `[data-aba-id="${id}"] { position: relative; left: ${left}px; top: ${top}px; }`;

/**
 * Alt-drag: keeps exactly one rule per element in aba-overrides.css and adds the new
 * distance to it, so a second Alt-drag updates the same rule instead of adding another.
 */
export function applyOffset(
  css: string,
  id: string,
  dx: number,
  dy: number,
): { css: string; left: number; top: number } {
  if (!ELEMENT_ID_RE.test(id)) throw new EditError('That is not a valid element id.');
  const escaped = id.replace(/[-]/g, '\\-');
  const rule = new RegExp(
    `^\\[data-aba-id="${escaped}"\\] \\{ position: relative; left: (-?\\d+)px; top: (-?\\d+)px; \\}$`,
    'm',
  );
  const m = rule.exec(css);
  const left = (m ? Number(m[1]) : 0) + Math.round(dx);
  const top = (m ? Number(m[2]) : 0) + Math.round(dy);
  const line = offsetLine(id, left, top);
  const next = m ? css.replace(rule, line) : `${css.replace(/\s*$/, '')}\n${line}\n`;
  return { css: next.replace(/^\n/, ''), left, top };
}
