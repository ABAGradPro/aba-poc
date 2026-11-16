import { EDIT_MODE_TAG, injectEditMode } from './preview.server.js';

describe('injectEditMode', () => {
  it('puts the edit-mode script right before </body>', () => {
    expect(injectEditMode('<html><body><p>x</p></body></html>')).toBe(
      `<html><body><p>x</p>${EDIT_MODE_TAG}</body></html>`,
    );
  });

  it('uses the last </body> and ignores letter case', () => {
    const out = injectEditMode('<body><pre>&lt;/body&gt;</pre></BODY>');
    expect(out.endsWith(`${EDIT_MODE_TAG}</BODY>`)).toBe(true);
  });

  it('appends the script when the page has no </body>', () => {
    expect(injectEditMode('<p>x</p>')).toBe(`<p>x</p>${EDIT_MODE_TAG}`);
  });
});
