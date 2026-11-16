import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { describeUserImages, imageBaseName, listImages, pruneStock, sniffImage } from './images.store.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe('sniffImage', () => {
  it('reads the type from the first bytes', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]))).toBe('jpg');
    expect(sniffImage(Buffer.from('GIF89a' + 'x'.repeat(10), 'latin1'))).toBe('gif');
    expect(sniffImage(Buffer.from('RIFF0000WEBPVP8 ', 'latin1'))).toBe('webp');
  });

  it('refuses anything else, whatever it is called', () => {
    expect(sniffImage(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<!doctype html><script>1</script>'))).toBeNull();
    expect(sniffImage(Buffer.from('short'))).toBeNull();
  });
});

describe('imageBaseName', () => {
  it('makes a name that is safe in a path and in HTML', () => {
    expect(imageBaseName('Our Shop Front (1).JPEG')).toBe('our-shop-front-1');
    expect(imageBaseName('../../etc/passwd.png')).toBe('etc-passwd');
    expect(imageBaseName('"><script>.png')).toBe('script');
    expect(imageBaseName('صورة.png')).toBe('image');
  });
});

describe('listImages and describeUserImages', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aba-img-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('separates the user’s images from stock photos and ignores other files', async () => {
    mkdirSync(path.join(dir, 'images'));
    mkdirSync(path.join(dir, '.aba'));
    writeFileSync(path.join(dir, 'images', 'logo.png'), PNG);
    writeFileSync(path.join(dir, 'images', 'hero.jpg'), PNG);
    writeFileSync(path.join(dir, 'images', 'notes.txt'), 'x');
    writeFileSync(path.join(dir, '.aba', 'images.json'), JSON.stringify({ 'logo.png': 'our  logo' }));
    writeFileSync(path.join(dir, '.aba', 'stock.json'), JSON.stringify({ hero: { words: 'coffee shop' } }));

    const images = await listImages(dir);
    expect(images.map((i) => [i.file, i.stock, i.caption])).toEqual([
      ['logo.png', false, 'our  logo'],
      ['hero.jpg', true, 'coffee shop'],
    ]);
    expect(await describeUserImages(dir)).toBe(
      'User images (already in the workspace; use them first, exactly at these paths):\n- images/logo.png: our logo',
    );
  });

  it('says nothing when the user has no images', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'aba-img-'));
    expect(await describeUserImages(empty)).toBe('');
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('pruneStock', () => {
  it('removes stock photos the site no longer uses, and nothing else', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aba-img-'));
    mkdirSync(path.join(dir, 'images'));
    mkdirSync(path.join(dir, '.aba'));
    for (const f of ['hero.jpg', 'old.jpg', 'mine.jpg', 'logo.png']) writeFileSync(path.join(dir, 'images', f), PNG);
    writeFileSync(path.join(dir, '.aba', 'images.json'), JSON.stringify({ 'mine.jpg': 'my photo', 'logo.png': '' }));
    writeFileSync(
      path.join(dir, '.aba', 'stock.json'),
      JSON.stringify({ hero: { words: 'cafe' }, old: { words: 'bread' }, mine: { words: 'x' } }),
    );
    writeFileSync(path.join(dir, 'index.html'), '<img src="images/hero.jpg" alt="">');

    expect(await pruneStock(dir)).toEqual(['old.jpg']);
    expect(existsSync(path.join(dir, 'images', 'old.jpg'))).toBe(false);
    for (const f of ['hero.jpg', 'mine.jpg', 'logo.png']) expect(existsSync(path.join(dir, 'images', f))).toBe(true);
    expect((await listImages(dir)).map((i) => i.file).sort()).toEqual(['hero.jpg', 'logo.png', 'mine.jpg']);
    rmSync(dir, { recursive: true, force: true });
  });
});
