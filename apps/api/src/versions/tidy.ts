import * as cheerio from 'cheerio';

export const OVERRIDES = 'aba-overrides.css';

/**
 * The deterministic clean-up after every generation (guide, Step 8):
 * - every element inside <body> gets a unique data-aba-id (existing ones are kept);
 * - aba-overrides.css is linked, and linked last, so its rules win.
 */
export function tidyHtml(html: string): { html: string; addedIds: number } {
  const $ = cheerio.load(html);

  const used = new Set<string>();
  $('[data-aba-id]').each((_, el) => {
    used.add($(el).attr('data-aba-id')!);
  });

  let addedIds = 0;
  const counters = new Map<string, number>();
  $('body *').each((_, el) => {
    const node = $(el);
    const current = node.attr('data-aba-id');
    if (current) return;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? 'el';
    let n = counters.get(tag) ?? 0;
    let id: string;
    do {
      n += 1;
      id = `${tag}-${n}`;
    } while (used.has(id));
    counters.set(tag, n);
    used.add(id);
    node.attr('data-aba-id', id);
    addedIds += 1;
  });

  $(`link[rel="stylesheet"][href$="${OVERRIDES}"]`).remove();
  if ($('head').length === 0) $('html').prepend('<head></head>');
  $('head').append(`<link rel="stylesheet" href="${OVERRIDES}">`);

  return { html: $.html(), addedIds };
}
