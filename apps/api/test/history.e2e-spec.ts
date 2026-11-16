import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PreviewServer } from '../src/preview/preview.server.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeHermes } from './fake-hermes.js';

type P = { id: string; folder: string };
type V = { id: string; number: number; kind: string; summary: string; commitSha: string };

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Versions and undo (e2e)', () => {
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
  /** A project built by the (fake) builder: version 1. */
  async function built(): Promise<P> {
    hermes.script = 'complete';
    const p: P = await (await req('POST', '/projects', owner, { name: 'History' })).json();
    const { runId } = await (await req('POST', `/projects/${p.id}/runs`, owner, { prompt: 'A bakery page' })).json();
    await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: owner } })).text();
    return p;
  }
  const nudge = async (p: P, dx: number): Promise<V> =>
    (await req('POST', `/projects/${p.id}/edits/offset`, owner, { id: 'title', dx, dy: 0 })).json();
  const list = async (p: P, cookie = owner): Promise<V[]> => (await req('GET', `/projects/${p.id}/versions`, cookie)).json();
  const dir = (p: P) => path.join(ws, p.folder);
  const show = (p: P, sha: string, file: string) =>
    execFileSync('git', ['-C', dir(p), 'show', `${sha}:${file}`], { encoding: 'utf8' });
  const gitLog = (p: P) =>
    execFileSync('git', ['-C', dir(p), 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');

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
    owner = await login('hist-owner');
    other = await login('hist-other');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    rmSync(ws, { recursive: true, force: true });
  });

  it('after four changes keeps exactly the newest three versions, while git keeps every commit', async () => {
    const p = await built(); // version 1
    await nudge(p, 10); // 2
    await nudge(p, 10); // 3
    await nudge(p, 10); // 4
    const shown = await list(p);
    expect(shown.map((v) => v.number)).toEqual([4, 3, 2]);
    expect(await prisma.version.count({ where: { projectId: p.id } })).toBe(3);
    expect(gitLog(p)).toEqual(['offset: title', 'offset: title', 'offset: title', 'generate: A bakery page', 'init']);
  });

  it('restoring the oldest shown version brings back its exact files, as a new version', async () => {
    const p = await built();
    const v2 = await nudge(p, 10);
    writeFileSync(path.join(dir(p), 'extra.txt'), 'added after version 2'); // committed with version 3
    await nudge(p, 25);
    await nudge(p, 40);
    const oldest = (await list(p)).at(-1)!;
    expect(oldest.number).toBe(v2.number);

    const res = await req('POST', `/projects/${p.id}/versions/${oldest.id}/restore`, owner);
    expect(res.status).toBe(201);
    const restored: V = await res.json();
    expect(restored).toMatchObject({ number: 5, kind: 'restore' });
    expect(restored.summary).toBe(`restore: ${oldest.commitSha.slice(0, 7)} (version 2)`);

    for (const f of ['index.html', 'styles.css', 'app.js', 'aba-overrides.css']) {
      expect(readFileSync(path.join(dir(p), f), 'utf8'), f).toBe(show(p, oldest.commitSha, f));
    }
    expect(existsSync(path.join(dir(p), 'extra.txt'))).toBe(false); // did not exist in version 2
    expect(readFileSync(path.join(dir(p), 'aba-overrides.css'), 'utf8')).toContain('left: 10px;');
    expect(gitLog(p)[0]).toBe(`restore: ${oldest.commitSha.slice(0, 7)} (version 2)`);
    expect(gitLog(p)).toHaveLength(6); // init + 4 changes + restore: nothing was deleted
    expect((await list(p)).map((v) => v.number)).toEqual([5, 4, 3]);

    const page = await (await fetch(`${preview}/p/${p.id}/`)).text();
    expect(page).toContain('Fake bakery');
  });

  it('a restore can itself be undone by restoring the version before it', async () => {
    const p = await built();
    await nudge(p, 10);
    const v3 = await nudge(p, 20); // left: 30px
    const v2 = (await list(p)).find((v) => v.number === 2)!;
    await req('POST', `/projects/${p.id}/versions/${v2.id}/restore`, owner); // back to left: 10px
    expect(readFileSync(path.join(dir(p), 'aba-overrides.css'), 'utf8')).toContain('left: 10px;');
    const v3row = (await list(p)).find((v) => v.number === v3.number)!;
    expect((await req('POST', `/projects/${p.id}/versions/${v3row.id}/restore`, owner)).status).toBe(201);
    expect(readFileSync(path.join(dir(p), 'aba-overrides.css'), 'utf8')).toContain('left: 30px;');
  });

  it('answers 404 for other users, unknown versions and versions of another project', async () => {
    const a = await built();
    const b = await built();
    const [va] = await list(a);
    const [vb] = await list(b);
    expect((await req('POST', `/projects/${a.id}/versions/${va.id}/restore`, other)).status).toBe(404);
    expect((await req('GET', `/projects/${a.id}/versions`, other)).status).toBe(404);
    expect((await req('POST', `/projects/${a.id}/versions/${vb.id}/restore`, owner)).status).toBe(404);
    expect((await req('POST', `/projects/${a.id}/versions/not-a-uuid/restore`, owner)).status).toBe(404);
  });

  it('refuses a restore while a build is running (409)', async () => {
    const p = await built();
    const [v] = await list(p);
    hermes.script = 'slow';
    const { runId } = await (await req('POST', `/projects/${p.id}/runs`, owner, { prompt: 'rebuild' })).json();
    expect((await req('POST', `/projects/${p.id}/versions/${v.id}/restore`, owner)).status).toBe(409);
    await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: owner } })).text();
    hermes.script = 'complete';
  });
});
