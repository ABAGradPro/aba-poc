import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Limits for a user's own images (stock photos fetched by Hermes are counted separately). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_USER_IMAGES = 12;
export const MAX_CAPTION = 120;

/** An image file in a project's images/ folder: lowercase words joined by hyphens plus a known extension. */
export const IMAGE_FILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png|webp|gif)$/;

export interface ProjectImage {
  file: string; // "shop-front.jpg" (the page uses "images/shop-front.jpg")
  caption: string; // the user's description; empty for stock photos without one
  stock: boolean; // fetched by Hermes from the free photo search
  size: number;
}

/** The real type of an image, from its first bytes (never from its name or what the browser says). */
export function sniffImage(data: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = data.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

/** "Our Shop Front (1).JPEG" → "our-shop-front-1": safe for file paths and for HTML. */
export function imageBaseName(original: string): string {
  const base = original
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return base || 'image';
}

const imagesDir = (dir: string) => path.join(dir, 'images');
const captionsFile = (dir: string) => path.join(dir, '.aba', 'images.json');
const stockFile = (dir: string) => path.join(dir, '.aba', 'stock.json');

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The user's captions: { "shop-front.jpg": "our shop from the street" }. */
export async function readCaptions(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [file, caption] of Object.entries(await readJson(captionsFile(dir)))) {
    if (IMAGE_FILE_RE.test(file) && typeof caption === 'string') out[file] = caption.slice(0, MAX_CAPTION);
  }
  return out;
}

export async function writeCaptions(dir: string, captions: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(captionsFile(dir)), { recursive: true });
  await writeFile(captionsFile(dir), JSON.stringify(captions, null, 1) + '\n');
}

/** Every image in the project's images/ folder, the user's first. */
export async function listImages(dir: string): Promise<ProjectImage[]> {
  let names: string[];
  try {
    names = await readdir(imagesDir(dir));
  } catch {
    return [];
  }
  const captions = await readCaptions(dir);
  // get_image.py records each stock photo under its name: { "hero": { words: "coffee shop" } }.
  const stock = await readJson(stockFile(dir));
  const out: ProjectImage[] = [];
  for (const file of names.filter((n) => IMAGE_FILE_RE.test(n)).sort()) {
    const info = await stat(path.join(imagesDir(dir), file)).catch(() => null);
    if (!info?.isFile()) continue;
    const isUser = file in captions;
    const entry = stock[file.replace(/\.jpg$/, '')] as { words?: unknown } | undefined;
    const isStock = !isUser && file.endsWith('.jpg') && entry !== undefined;
    out.push({
      file,
      caption: isUser ? captions[file] : typeof entry?.words === 'string' ? entry.words : '',
      stock: isStock,
      size: info.size,
    });
  }
  return out.sort((a, b) => Number(a.stock) - Number(b.stock));
}

/**
 * The lines added to a build request so Hermes knows which of the user's images exist.
 * Empty when the user has not uploaded any (then the skill uses stock photos).
 */
export async function describeUserImages(dir: string): Promise<string> {
  const mine = (await listImages(dir)).filter((i) => !i.stock);
  if (!mine.length) return '';
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  return [
    'User images (already in the workspace; use them first, exactly at these paths):',
    ...mine.map((i) => `- images/${i.file}: ${clean(i.caption) || 'no description given'}`),
  ].join('\n');
}

/**
 * After a build: removes stock photos that the new site does not use (and their entries in
 * .aba/stock.json), so rebuilding never fills the project with old photos. The user's own
 * images are never removed. Returns the file names that were removed.
 */
export async function pruneStock(dir: string): Promise<string[]> {
  const stock = await readJson(stockFile(dir));
  const names = Object.keys(stock);
  if (!names.length) return [];
  const captions = await readCaptions(dir);
  let site = '';
  for (const file of ['index.html', 'styles.css', 'app.js', 'aba-overrides.css']) {
    site += await readFile(path.join(dir, file), 'utf8').catch(() => '');
  }
  const removed: string[] = [];
  for (const name of names) {
    const file = `${name}.jpg`;
    if (!IMAGE_FILE_RE.test(file) || file in captions || site.includes(`images/${file}`)) continue;
    await rm(path.join(imagesDir(dir), file), { force: true });
    delete stock[name];
    removed.push(file);
  }
  if (removed.length) await writeFile(stockFile(dir), JSON.stringify(stock, null, 1) + '\n');
  return removed;
}
