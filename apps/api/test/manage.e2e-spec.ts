import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PreviewServer } from '../src/preview/preview.server.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeHermes } from './fake-hermes.js';

type P = { id: string; name: string; folder: string };

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Project names, rename and delete (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let preview: string;
  let owner: string;
  let other: string;
  const hermes = new FakeHermes();
  const root = mkdtempSync(path.join(tmpdir(), 'aba-data-'));
  const ws = path.join(root, 'workspaces');
  const trash = path.join(root, 'trash');

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
  const create = async (name: string): Promise<P> => (await req('POST', '/projects', owner, { name })).json();
  const gitLog = (dir: string) =>
    execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');

  beforeAll(async () => {
    execFileSync('mkdir', ['-p', ws]);
    await hermes.start();
    hermes.workspaces = ws;
    process.env.HERMES_URL = hermes.url;
    process.env.HERMES_API_KEY = 'test-hermes-key';
    process.env.WORKSPACES_DIR = ws;
    process.env.TRASH_DIR = trash;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    preview = app.get(PreviewServer).url;
    prisma = app.get(PrismaService);
    owner = await login('names-owner');
    other = await login('names-other');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    delete process.env.TRASH_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('names a new project folder after the project', async () => {
    const p = await create('Coffee shop');
    expect(p.folder).toBe(`coffee-shop-${p.id.slice(0, 8)}`);
    expect(gitLog(path.join(ws, p.folder))).toEqual(['init']);
    const arabic = await create('مطعم 3ageed');
    expect(arabic.name).toBe('مطعم 3ageed'); // the real name is kept as typed
    expect(arabic.folder).toBe(`3ageed-${arabic.id.slice(0, 8)}`);
  });

  it('renames the project and its folder, keeping git history and the preview', async () => {
    const p = await create('Coffee shop');
    const { runId } = await (await req('POST', `/projects/${p.id}/runs`, owner, { prompt: 'A bakery page' })).json();
    await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: owner } })).text();

    const res = await req('PATCH', `/projects/${p.id}`, owner, { name: 'Amman Roastery' });
    expect(res.status).toBe(200);
    const renamed: P = await res.json();
    expect(renamed).toMatchObject({ id: p.id, name: 'Amman Roastery', folder: `amman-roastery-${p.id.slice(0, 8)}` });
    expect(existsSync(path.join(ws, p.folder))).toBe(false);
    expect(gitLog(path.join(ws, renamed.folder))).toEqual(['generate: A bakery page', 'init']);
    const page = await fetch(`${preview}/p/${p.id}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Fake bakery');

    // Same safe name (only case changes): the name updates, the folder stays.
    const again: P = await (await req('PATCH', `/projects/${p.id}`, owner, { name: 'AMMAN roastery' })).json();
    expect(again).toMatchObject({ name: 'AMMAN roastery', folder: renamed.folder });
  });

  it('deletes a project: rows removed, folder moved to the trash', async () => {
    const p = await create('Throwaway');
    const res = await req('DELETE', `/projects/${p.id}`, owner);
    expect(res.status).toBe(204);
    expect(await prisma.project.findUnique({ where: { id: p.id } })).toBeNull();
    expect(existsSync(path.join(ws, p.folder))).toBe(false);
    const inTrash = readdirSync(trash).find((f) => f.startsWith(`${p.folder}-`));
    expect(inTrash).toBeTruthy();
    expect(gitLog(path.join(trash, inTrash!))).toEqual(['init']); // still recoverable
    expect((await req('GET', `/projects/${p.id}`, owner)).status).toBe(404);
    expect((await fetch(`${preview}/p/${p.id}/`)).status).toBe(404);
  });

  it("answers 404 when another user tries to rename or delete someone's project", async () => {
    const p = await create('Mine');
    expect((await req('PATCH', `/projects/${p.id}`, other, { name: 'Stolen' })).status).toBe(404);
    expect((await req('DELETE', `/projects/${p.id}`, other)).status).toBe(404);
    expect((await req('GET', `/projects/${p.id}`, owner)).status).toBe(200);
  });

  it('refuses rename and delete with 409 while the project is being built', async () => {
    hermes.script = 'slow';
    const p = await create('Busy');
    const { runId } = await (await req('POST', `/projects/${p.id}/runs`, owner, { prompt: 'x' })).json();
    expect((await req('PATCH', `/projects/${p.id}`, owner, { name: 'Renamed' })).status).toBe(409);
    expect((await req('DELETE', `/projects/${p.id}`, owner)).status).toBe(409);
    await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: owner } })).text();
    expect((await req('PATCH', `/projects/${p.id}`, owner, { name: 'Renamed' })).status).toBe(200);
    hermes.script = 'complete';
  });

  it('rejects empty or overlong names', async () => {
    const p = await create('Valid');
    expect((await req('PATCH', `/projects/${p.id}`, owner, { name: '' })).status).toBe(400);
    expect((await req('PATCH', `/projects/${p.id}`, owner, { name: 'x'.repeat(81) })).status).toBe(400);
  });
});
