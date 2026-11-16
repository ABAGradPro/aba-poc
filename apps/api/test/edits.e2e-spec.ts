import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cheerio from 'cheerio';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PreviewServer } from '../src/preview/preview.server.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FRIENDLY } from '../src/runs/runs.service.js';
import { FakeHermes } from './fake-hermes.js';

type P = { id: string; folder: string };

const CARDS_PAGE =
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="aba-overrides.css"></head><body>' +
  '<main data-aba-id="main"><section data-aba-id="cards">' +
  '<div data-aba-id="card-1">One</div><div data-aba-id="card-2">Two</div><div data-aba-id="card-3">Three</div>' +
  '</section><a data-aba-id="cta" class="btn" href="#menu">Menu</a></main>' +
  '<script data-aba-id="script-1" src="app.js"></script></body></html>';

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Click-to-edit and drag-and-drop (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let preview: string;
  let owner: string;
  let other: string;
  const hermes = new FakeHermes();
  const ws = mkdtempSync(path.join(tmpdir(), 'aba-ws-'));

  const req = (method: string, url: string, cookie: string, body?: unknown) =>
    fetch(`${base}/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
  async function login(name: string) {
    const creds = { username: `e2e-${name}-${Date.now()}`, password: 'a long password' };
    const h = { 'Content-Type': 'application/json' };
    await fetch(`${base}/api/auth/register`, { method: 'POST', headers: h, body: JSON.stringify(creds) });
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: h, body: JSON.stringify(creds) });
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  /** A project whose page is CARDS_PAGE, committed as version 1 (like a finished build). */
  async function project(): Promise<P> {
    const p: P = await (await req('POST', '/projects', owner, { name: 'Cards' })).json();
    const dir = path.join(ws, p.folder);
    writeFileSync(path.join(dir, 'index.html'), CARDS_PAGE);
    writeFileSync(path.join(dir, 'styles.css'), '.btn{padding:8px}\n');
    writeFileSync(path.join(dir, 'app.js'), '');
    writeFileSync(path.join(dir, 'aba-overrides.css'), '/* ABA overrides: written by drag-and-drop edits */\n');
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'generate: cards']);
    return p;
  }
  const page = (p: P) => cheerio.load(readFileSync(path.join(ws, p.folder, 'index.html'), 'utf8'));
  const file = (p: P, f: string) => readFileSync(path.join(ws, p.folder, f), 'utf8');
  const log = (p: P) => execFileSync('git', ['-C', path.join(ws, p.folder), 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
  const events = async (runId: string) =>
    (await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: owner } })).text())
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)));

  beforeAll(async () => {
    await hermes.start();
    hermes.workspaces = ws;
    process.env.HERMES_URL = hermes.url;
    process.env.HERMES_API_KEY = 'test-hermes-key';
    process.env.WORKSPACES_DIR = ws;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    preview = app.get(PreviewServer).url;
    prisma = app.get(PrismaService);
    owner = await login('edit-owner');
    other = await login('edit-other');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    rmSync(ws, { recursive: true, force: true });
  });

  it('serves the built edit-mode script with the GUI origin filled in', async () => {
    const js = await (await fetch(`${preview}/__aba/edit-mode.js`)).text();
    expect(js).toContain('http://localhost:5173');
    expect(js).not.toContain('__ABA_PARENT_ORIGIN__');
    expect(js).toContain('aba:select');
  });

  it('edits one element by prompt: only that element changes, CSS appended, "edit: <id>" committed', async () => {
    const p = await project();
    hermes.script = 'edit';
    hermes.editReply =
      '```json\n{"html":"<a data-aba-id=\\"cta\\" class=\\"btn btn-green\\" href=\\"#menu\\">Menu</a>",' +
      '"css":"[data-aba-id=\\"cta\\"] { background: #1e7d32; border-radius: 12px; }"}\n```';
    const before = page(p);
    const res = await req('POST', `/projects/${p.id}/edits/element`, owner, { id: 'cta', prompt: 'Make it green with rounded corners' });
    expect(res.status).toBe(202);
    const evs = await events((await res.json()).runId);
    expect(evs.find((e) => e.type === 'version.created').version).toMatchObject({ kind: 'edit', summary: 'edit: cta' });
    expect(evs.at(-1)).toMatchObject({ status: 'completed' });

    const after = page(p);
    expect(after('[data-aba-id="cta"]').attr('class')).toBe('btn btn-green');
    after('[data-aba-id="cta"]').attr('class', 'btn');
    expect(after.html()).toBe(before.html()); // nothing else on the page changed
    expect(file(p, 'styles.css')).toContain('/* edit: cta */\n[data-aba-id="cta"] { background: #1e7d32; border-radius: 12px; }');
    expect(log(p)[0]).toBe('edit: cta');

    const call = hermes.calls.filter((c) => c.path === '/v1/runs').at(-1)!;
    expect(call.body.input).toContain('Use the aba-edit-element skill.');
    expect(call.body.input).toContain('<a data-aba-id="cta" class="btn" href="#menu">Menu</a>');
    expect(call.body.session_id).toMatch(new RegExp(`^${p.id}-edit-`));
  });

  it('changes nothing when the answer is not usable (wrong id)', async () => {
    const p = await project();
    hermes.script = 'edit';
    hermes.editReply = '{"html":"<a data-aba-id=\\"other\\">x</a>","css":""}';
    const before = file(p, 'index.html');
    const { runId } = await (await req('POST', `/projects/${p.id}/edits/element`, owner, { id: 'cta', prompt: 'x' })).json();
    const evs = await events(runId);
    expect(evs.at(-1)).toMatchObject({ status: 'failed', text: FRIENDLY.badEdit });
    expect(file(p, 'index.html')).toBe(before);
    expect(log(p)[0]).toBe('generate: cards');
  });

  it('answers 404 for an element that is not on the page, and for other users', async () => {
    const p = await project();
    expect((await req('POST', `/projects/${p.id}/edits/element`, owner, { id: 'nope', prompt: 'x' })).status).toBe(404);
    expect((await req('POST', `/projects/${p.id}/edits/element`, other, { id: 'cta', prompt: 'x' })).status).toBe(404);
    expect((await req('POST', `/projects/${p.id}/edits/move`, other, { id: 'card-3', parentId: 'cards', beforeId: 'card-1' })).status).toBe(404);
    expect((await req('POST', `/projects/${p.id}/edits/offset`, other, { id: 'cta', dx: 1, dy: 1 })).status).toBe(404);
  });

  it('drag: moves the third card to the top and commits "move: card-3", with no Run and no Hermes call', async () => {
    const p = await project();
    const runsBefore = await prisma.run.count();
    const hermesBefore = hermes.calls.length;
    const res = await req('POST', `/projects/${p.id}/edits/move`, owner, { id: 'card-3', parentId: 'cards', beforeId: 'card-1' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ kind: 'move', summary: 'move: card-3' });
    const $ = page(p);
    expect($('section').children().map((_, el) => $(el).attr('data-aba-id')).get()).toEqual(['card-3', 'card-1', 'card-2']);
    expect(log(p)[0]).toBe('move: card-3');
    expect(await prisma.run.count()).toBe(runsBefore);
    expect(hermes.calls.length).toBe(hermesBefore);
  });

  it('drag: refuses drops into the element itself (400) and changes nothing', async () => {
    const p = await project();
    const before = file(p, 'index.html');
    const res = await req('POST', `/projects/${p.id}/edits/move`, owner, { id: 'cards', parentId: 'card-2', beforeId: null });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('inside itself');
    expect(file(p, 'index.html')).toBe(before);
  });

  it('Alt-drag: adds exactly one rule, a second Alt-drag updates the same rule', async () => {
    const p = await project();
    const runsBefore = await prisma.run.count();
    expect((await req('POST', `/projects/${p.id}/edits/offset`, owner, { id: 'cta', dx: 12, dy: -4 })).status).toBe(201);
    expect(file(p, 'aba-overrides.css').match(/data-aba-id="cta"/g)).toHaveLength(1);
    expect((await req('POST', `/projects/${p.id}/edits/offset`, owner, { id: 'cta', dx: 8, dy: 10 })).status).toBe(201);
    const css = file(p, 'aba-overrides.css');
    expect(css.match(/data-aba-id="cta"/g)).toHaveLength(1);
    expect(css).toContain('[data-aba-id="cta"] { position: relative; left: 20px; top: 6px; }');
    expect(log(p).slice(0, 2)).toEqual(['offset: cta', 'offset: cta']);
    expect(await prisma.run.count()).toBe(runsBefore);
  });

  it('rejects bad input (400) and edits while a build is running (409)', async () => {
    const p = await project();
    expect((await req('POST', `/projects/${p.id}/edits/offset`, owner, { id: 'cta', dx: 1.5, dy: 0 })).status).toBe(400);
    expect((await req('POST', `/projects/${p.id}/edits/move`, owner, { id: '../x', parentId: null, beforeId: null })).status).toBe(400);
    hermes.script = 'slow';
    const { runId } = await (await req('POST', `/projects/${p.id}/runs`, owner, { prompt: 'rebuild' })).json();
    expect((await req('POST', `/projects/${p.id}/edits/offset`, owner, { id: 'cta', dx: 1, dy: 1 })).status).toBe(409);
    expect((await req('POST', `/projects/${p.id}/edits/element`, owner, { id: 'cta', prompt: 'x' })).status).toBe(409);
    await events(runId);
    hermes.script = 'complete';
  });
});
