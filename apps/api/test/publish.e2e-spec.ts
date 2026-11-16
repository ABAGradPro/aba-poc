import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeHermes } from './fake-hermes.js';

type P = { id: string; folder: string; slug: string | null; liveUrl: string | null };

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Publish and roll back (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let dropletUrl: string;
  let droplet: Server;
  let owner: string;
  let other: string;
  const hermes = new FakeHermes();
  const ws = mkdtempSync(path.join(tmpdir(), 'aba-ws-'));
  const apps = mkdtempSync(path.join(tmpdir(), 'aba-droplet-'));

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
  const events = async (runId: string) =>
    (await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: owner } })).text())
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)));
  async function run(url: string, body?: unknown) {
    const res = await req('POST', url, owner, body);
    expect(res.status).toBe(202);
    return events((await res.json()).runId);
  }
  async function built(): Promise<P> {
    hermes.script = 'complete';
    const p: P = await (await req('POST', '/projects', owner, { name: 'Shop' })).json();
    await run(`/projects/${p.id}/runs`, { prompt: 'A bakery page' });
    return p;
  }
  const live = async (slug: string) => {
    const res = await fetch(`${dropletUrl}/${slug}/`);
    return res.ok ? res.text() : null;
  };

  beforeAll(async () => {
    // A tiny stand-in for the droplet's Nginx: serves <apps>/<slug>/index.html.
    droplet = createServer((rq, rs) => {
      const m = /^\/([a-z0-9-]+)\/$/.exec(rq.url ?? '');
      let body: Buffer | null = null;
      try {
        if (m) body = readFileSync(path.join(apps, m[1], 'index.html'));
      } catch {
        body = null;
      }
      if (body) rs.writeHead(200, { 'Content-Type': 'text/html' }).end(body);
      else rs.writeHead(404).end();
    });
    await new Promise<void>((r) => droplet.listen(0, '127.0.0.1', r));
    dropletUrl = `http://127.0.0.1:${(droplet.address() as AddressInfo).port}`;

    await hermes.start();
    hermes.workspaces = ws;
    hermes.droplet = apps;
    process.env.HERMES_URL = hermes.url;
    process.env.HERMES_API_KEY = 'test-hermes-key';
    process.env.WORKSPACES_DIR = ws;
    process.env.PUBLISH_BASE_URL = dropletUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    owner = await login('pub-owner');
    other = await login('pub-other');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    droplet.closeAllConnections();
    await new Promise<void>((r) => droplet.close(() => r()));
    delete process.env.PUBLISH_BASE_URL;
    rmSync(ws, { recursive: true, force: true });
    rmSync(apps, { recursive: true, force: true });
  });

  it('publishes: asks Hermes for aba-publish, confirms the live page itself, then records the address', async () => {
    const p = await built();
    hermes.script = 'release';
    const slug = `shop-${Date.now()}`;
    const evs = await run(`/projects/${p.id}/publish`, { slug });
    expect(evs.at(-1)).toMatchObject({ status: 'completed', text: `Your app is live at ${dropletUrl}/${slug}/` });
    expect(evs.some((e) => e.type === 'published')).toBe(true);
    const call = hermes.calls.filter((c) => c.path === '/v1/runs').at(-1)!;
    expect(call.body.input).toBe(`Use the aba-publish skill. Workspace: /workspaces/${p.folder}. Slug: ${slug}.`);
    expect(await live(slug)).toBe(readFileSync(path.join(ws, p.folder, 'index.html'), 'utf8'));
    const saved: P = await (await req('GET', `/projects/${p.id}`, owner)).json();
    expect(saved).toMatchObject({ slug, liveUrl: `${dropletUrl}/${slug}/` });
  });

  it('a second publish shows the change; roll back brings the previous version back', async () => {
    const p = await built();
    hermes.script = 'release';
    const slug = `cafe-${Date.now()}`;
    await run(`/projects/${p.id}/publish`, { slug });
    const first = await live(slug);
    await req('POST', `/projects/${p.id}/edits/offset`, owner, { id: 'title', dx: 5, dy: 5 });
    await req('POST', `/projects/${p.id}/edits/move`, owner, { id: 'title', parentId: 'main', beforeId: null });
    await run(`/projects/${p.id}/publish`, { slug });
    const second = await live(slug);
    expect(second).not.toBe(first);
    expect(hermes.releases.get(slug)).toHaveLength(2);

    const evs = await run(`/projects/${p.id}/rollback`);
    expect(evs.at(-1)).toMatchObject({ status: 'completed' });
    expect(await live(slug)).toBe(first);
    expect(hermes.calls.filter((c) => c.path === '/v1/runs').at(-1)!.body.input).toBe(
      `Use the aba-rollback skill. Slug: ${slug}.`,
    );
  });

  it('refuses to publish when aba-verify fails, and says why', async () => {
    const p = await built();
    hermes.script = 'verifyfail';
    const slug = `broken-${Date.now()}`;
    const evs = await run(`/projects/${p.id}/publish`, { slug });
    expect(evs.at(-1).status).toBe('failed');
    expect(evs.at(-1).text).toContain('Not published');
    expect(evs.at(-1).text).toContain('Uncaught Error: x');
    expect(await live(slug)).toBeNull();
    const saved: P = await (await req('GET', `/projects/${p.id}`, owner)).json();
    expect(saved.slug).toBeNull();
  });

  it('roll back with nothing to go back to fails clearly', async () => {
    const p = await built();
    hermes.script = 'release';
    const slug = `once-${Date.now()}`;
    await run(`/projects/${p.id}/publish`, { slug });
    const evs = await run(`/projects/${p.id}/rollback`);
    expect(evs.at(-1)).toMatchObject({ status: 'failed' });
    expect(evs.at(-1).text).toContain('no previous release');
  });

  it('checks the address, ownership and that the app exists', async () => {
    const a = await built();
    const b = await built();
    hermes.script = 'release';
    const slug = `taken-${Date.now()}`;
    await run(`/projects/${a.id}/publish`, { slug });
    expect((await req('POST', `/projects/${b.id}/publish`, owner, { slug })).status).toBe(409); // used by project a
    for (const bad of ['Has Spaces', '../etc', 'a--b', '-x', 'x'.repeat(41), '']) {
      expect((await req('POST', `/projects/${b.id}/publish`, owner, { slug: bad })).status, bad).toBe(400);
    }
    expect((await req('POST', `/projects/${a.id}/publish`, other, { slug: 'mine' })).status).toBe(404);
    expect((await req('POST', `/projects/${a.id}/rollback`, other)).status).toBe(404);
    expect((await req('POST', `/projects/${b.id}/rollback`, owner)).status).toBe(400); // never published
    const empty: P = await (await req('POST', '/projects', owner, { name: 'Empty' })).json();
    expect((await req('POST', `/projects/${empty.id}/publish`, owner, { slug: `e-${Date.now()}` })).status).toBe(400);
  });
});
