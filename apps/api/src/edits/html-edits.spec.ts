import * as cheerio from 'cheerio';
import { applyOffset, EditError, extractElement, moveElement, parseEditReply, replaceElement } from './html-edits.js';

const PAGE =
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body>' +
  '<main data-aba-id="main">' +
  '<section data-aba-id="cards">' +
  '<div data-aba-id="card-1"><h3 data-aba-id="t1">One</h3></div>' +
  '<div data-aba-id="card-2"><h3 data-aba-id="t2">Two</h3></div>' +
  '<div data-aba-id="card-3"><h3 data-aba-id="t3">Three</h3></div>' +
  '</section>' +
  '<a data-aba-id="cta" class="btn" href="#menu">Menu</a>' +
  '</main></body></html>';

const order = (html: string, sel: string) => {
  const $ = cheerio.load(html);
  return $(sel).children().map((_, el) => $(el).attr('data-aba-id')).get();
};

describe('extractElement', () => {
  it('returns one element with its children, or null', () => {
    expect(extractElement(PAGE, 'card-2')).toBe('<div data-aba-id="card-2"><h3 data-aba-id="t2">Two</h3></div>');
    expect(extractElement(PAGE, 'missing')).toBeNull();
  });
});

describe('parseEditReply', () => {
  const ok = '{"html":"<a data-aba-id=\\"cta\\" class=\\"btn\\" href=\\"#menu\\">Menu</a>","css":"[data-aba-id=\\"cta\\"]{background:#1e7d32}"}';

  it('accepts one root element that keeps the same id', () => {
    expect(parseEditReply(ok, 'cta')).toEqual({
      html: '<a data-aba-id="cta" class="btn" href="#menu">Menu</a>',
      css: '[data-aba-id="cta"]{background:#1e7d32}',
    });
  });

  it('removes a stray ```json fence and text around the object', () => {
    expect(parseEditReply('```json\n' + ok + '\n```', 'cta').html).toContain('data-aba-id="cta"');
    expect(parseEditReply('Here it is: ' + ok, 'cta').css).toContain('#1e7d32');
  });

  it.each([
    ['not JSON', 'Sure! I made it green.'],
    ['broken JSON', '{"html": "<a data-aba-id=\\"cta\\">'],
    ['no html', '{"css": "a{}"}'],
    ['a different id', '{"html":"<a data-aba-id=\\"other\\">x</a>","css":""}'],
    ['two root elements', '{"html":"<a data-aba-id=\\"cta\\">x</a><p>y</p>","css":""}'],
    ['loose text next to the element', '{"html":"hello <a data-aba-id=\\"cta\\">x</a>","css":""}'],
    ['an added script', '{"html":"<div data-aba-id=\\"cta\\"><script>alert(1)</script></div>","css":""}'],
  ])('rejects %s', (_, reply) => {
    expect(() => parseEditReply(reply, 'cta')).toThrow(EditError);
  });
});

describe('replaceElement', () => {
  it('changes only that element', () => {
    const out = replaceElement(PAGE, 'cta', '<a data-aba-id="cta" class="btn green" href="#menu">Menu</a>');
    expect(out).toContain('class="btn green"');
    expect(out.replace('class="btn green"', 'class="btn"')).toBe(cheerio.load(PAGE).html());
  });

  it('refuses an element that no longer exists', () => {
    expect(() => replaceElement(PAGE, 'gone', '<p data-aba-id="gone"></p>')).toThrow(EditError);
  });
});

describe('moveElement', () => {
  it('moves the third card to the top', () => {
    expect(order(moveElement(PAGE, 'card-3', 'cards', 'card-1'), 'section')).toEqual(['card-3', 'card-1', 'card-2']);
  });

  it('moves to the end when there is no element after it', () => {
    expect(order(moveElement(PAGE, 'card-1', 'cards', null), 'section')).toEqual(['card-2', 'card-3', 'card-1']);
  });

  it('moves into another parent, and into <body> when parentId is null', () => {
    expect(order(moveElement(PAGE, 'cta', 'cards', 'card-2'), 'section')).toEqual(['card-1', 'cta', 'card-2', 'card-3']);
    expect(order(moveElement(PAGE, 'cta', null, 'main'), 'body')).toEqual(['cta', 'main']);
  });

  it('refuses drops into the element itself or its own children', () => {
    expect(() => moveElement(PAGE, 'cards', 'cards', null)).toThrow('inside itself');
    expect(() => moveElement(PAGE, 'cards', 'card-2', null)).toThrow('inside itself');
    expect(() => moveElement(PAGE, 'card-1', 'cards', 'card-1')).toThrow('before itself');
  });

  it('refuses places that do not exist', () => {
    expect(() => moveElement(PAGE, 'nope', 'cards', null)).toThrow(EditError);
    expect(() => moveElement(PAGE, 'cta', 'nope', null)).toThrow(EditError);
    expect(() => moveElement(PAGE, 'cta', 'cards', 't1')).toThrow(EditError); // t1 is not a direct child
  });
});

describe('applyOffset', () => {
  const header = '/* ABA overrides: written by drag-and-drop edits */\n';

  it('adds exactly one rule, then updates that same rule', () => {
    const first = applyOffset(header, 'cta', 12, -4);
    expect(first.css).toBe(`${header}[data-aba-id="cta"] { position: relative; left: 12px; top: -4px; }\n`);
    const second = applyOffset(first.css, 'cta', 8, 10);
    expect(second).toMatchObject({ left: 20, top: 6 });
    expect(second.css.match(/data-aba-id="cta"/g)).toHaveLength(1);
    expect(second.css).toContain('left: 20px; top: 6px;');
  });

  it('keeps rules for other elements apart', () => {
    const a = applyOffset(header, 'card-1', 5, 5).css;
    const b = applyOffset(a, 'card-12', 1, 1).css;
    const c = applyOffset(b, 'card-1', 5, 5).css;
    expect(c).toContain('[data-aba-id="card-1"] { position: relative; left: 10px; top: 10px; }');
    expect(c).toContain('[data-aba-id="card-12"] { position: relative; left: 1px; top: 1px; }');
  });
});
