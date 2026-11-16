import * as cheerio from 'cheerio';
import { tidyHtml } from './tidy.js';

const page = (head: string, body: string) =>
  `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

describe('tidyHtml', () => {
  it('adds a unique data-aba-id to every body element that has none, keeping existing ids', () => {
    const { html, addedIds } = tidyHtml(
      page(
        '<link rel="stylesheet" href="styles.css">',
        '<header data-aba-id="top"><h1>Hi</h1><p>One</p><p>Two</p></header><script src="app.js"></script>',
      ),
    );
    const $ = cheerio.load(html);
    const ids = $('body *').map((_, el) => $(el).attr('data-aba-id')).get();
    expect(addedIds).toBe(4); // h1, two p, script
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect($('header').attr('data-aba-id')).toBe('top');
  });

  it('never reuses an id that already exists on the page', () => {
    const { html } = tidyHtml(page('', '<p data-aba-id="p-1">a</p><p>b</p>'));
    const $ = cheerio.load(html);
    expect($('p').eq(1).attr('data-aba-id')).toBe('p-2');
  });

  it('links aba-overrides.css last, even if it was linked earlier or missing', () => {
    for (const head of [
      '<link rel="stylesheet" href="styles.css">',
      '<link rel="stylesheet" href="aba-overrides.css"><link rel="stylesheet" href="styles.css">',
    ]) {
      const $ = cheerio.load(tidyHtml(page(head, '<p>x</p>')).html);
      const hrefs = $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get();
      expect(hrefs).toEqual(['styles.css', 'aba-overrides.css']);
    }
  });

  it('changes nothing else when the page already follows the rules', () => {
    const input = page(
      '<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="aba-overrides.css">',
      '<main data-aba-id="main"><p data-aba-id="intro">Hello</p></main>',
    );
    const { html, addedIds } = tidyHtml(input);
    expect(addedIds).toBe(0);
    expect(html).toBe(input);
  });
});
