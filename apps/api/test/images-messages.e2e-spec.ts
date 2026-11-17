import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PreviewServer } from '../src/preview/preview.server.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeHermes } from './fake-hermes.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Images and contact messages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let preview: string;
  let cookie: string;
  let project: { id: string; folder: string };
  const hermes = new FakeHermes();
  const ws = mkdtempSync(path.join(tmpdir(), 'aba-ws-'));
  const json = (body: unknown, method = 'POST'): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const upload = (name: string, data: Buffer, caption = '') =>
    fetch(`${base}/api/projects/${project.id}/images?name=${encodeURIComponent(name)}&caption=${encodeURIComponent(caption)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie },
      body: new Uint8Array(data),
    });
  const images = async () =>
    (await (await fetch(`${base}/api/projects/${project.id}/images`, { headers: { Cookie: cookie } })).json()) as {
      file: string;
      caption: string;
      stock: boolean;
    }[];
  const contact = (body: string, id = project.id) =>
    fetch(`${preview}/p/${id}/__aba/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

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
    const creds = { username: `e2e-images-${Date.now()}`, password: 'a long password' };
    await fetch(`${base}/api/auth/register`, { ...json(creds), headers: { 'Content-Type': 'application/json' } });
    const login = await fetch(`${base}/api/auth/login`, {
      ...json(creds),
      headers: { 'Content-Type': 'application/json' },
    });
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    project = await (await fetch(`${base}/api/projects`, json({ name: 'Cafe' }))).json();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    rmSync(ws, { recursive: true, force: true });
  });

  it('saves an uploaded image under a safe name, with its description, and commits it', async () => {
    const res = await upload('Our Shop Front (1).PNG', PNG, 'our shop from the street');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ file: 'our-shop-front-1.png', caption: 'our shop from the street', stock: false });
    const dir = path.join(ws, project.folder);
    expect(readFileSync(path.join(dir, 'images', 'our-shop-front-1.png')).equals(PNG)).toBe(true);
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim()).toBe(
      'images: add our-shop-front-1.png',
    );
    expect(execFileSync('git', ['status', '--short'], { cwd: dir }).toString()).toBe('');
    // An image upload is not a version of the site.
    expect(await prisma.version.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('never overwrites: the same name again gets a number', async () => {
    expect(await (await upload('our shop front (1).png', PNG)).json()).toMatchObject({ file: 'our-shop-front-1-2.png' });
  });

  it('refuses files that are not images, and files that are too large', async () => {
    const svg = await upload('logo.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'));
    expect(svg.status).toBe(400);
    const big = await upload('big.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(big.status).toBe(413);
    expect((await images()).map((i) => i.file)).toEqual(['our-shop-front-1-2.png', 'our-shop-front-1.png']);
  });

  it('the preview serves the image, and the build request tells Hermes about the user’s images', async () => {
    const served = await fetch(`${preview}/p/${project.id}/images/our-shop-front-1.png`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toContain('image/png');

    hermes.script = 'complete';
    const { runId } = await (await fetch(`${base}/api/projects/${project.id}/runs`, json({ prompt: 'A cafe site' }))).json();
    await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: cookie } })).text();
    const call = hermes.calls.find((c) => c.path === '/v1/runs' && c.body.session_id === project.id)!;
    expect(call.body.input).toBe(
      [
        'Use the aba-generate-spa skill.',
        `Workspace: /workspaces/${project.folder}`,
        'Request: A cafe site',
        'User images (already in the workspace; use them first, exactly at these paths):',
        '- images/our-shop-front-1-2.png: no description given',
        '- images/our-shop-front-1.png: our shop from the street',
      ].join('\n'),
    );
  });

  it('changes a description and removes an image; a path outside images/ is not found', async () => {
    const patched = await fetch(
      `${base}/api/projects/${project.id}/images/our-shop-front-1-2.png`,
      json({ caption: 'the counter' }, 'PATCH'),
    );
    expect(await patched.json()).toMatchObject({ caption: 'the counter' });

    const del = (file: string) =>
      fetch(`${base}/api/projects/${project.id}/images/${file}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect((await del('..%2Findex.html')).status).toBe(404);
    expect((await del('index.html')).status).toBe(404);
    expect(existsSync(path.join(ws, project.folder, 'index.html'))).toBe(true);
    expect((await del('our-shop-front-1.png')).status).toBe(204);
    expect((await images()).map((i) => [i.file, i.caption])).toEqual([['our-shop-front-1-2.png', 'the counter']]);
  });

  it('images need a login', async () => {
    expect((await fetch(`${base}/api/projects/${project.id}/images`)).status).toBe(401);
  });

  it('a contact form on the preview saves a message for the owner', async () => {
    const res = await contact(
      JSON.stringify({ name: 'Lina Haddad', email: 'lina@example.com', phone: '0790000000', message: 'Do you take orders?', date: '2026-12-01' }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBeNull(); // other sites cannot post here

    const list = await (await fetch(`${base}/api/projects/${project.id}/messages`, { headers: { Cookie: cookie } })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Lina Haddad',
      contact: 'lina@example.com · 0790000000',
      message: 'Do you take orders?',
      fields: { date: '2026-12-01' },
    });

    const gone = await fetch(`${base}/api/projects/${project.id}/messages/${list[0].id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(gone.status).toBe(204);
    expect(await prisma.message.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('refuses broken, empty and oversized forms, and unknown projects', async () => {
    expect((await contact('not json')).status).toBe(400);
    expect((await contact('{}')).status).toBe(400);
    expect((await contact('["a"]')).status).toBe(400);
    expect((await contact(JSON.stringify({ message: 'x'.repeat(20_000) }))).status).toBe(400);
    expect((await contact(JSON.stringify({ name: 'x' }), '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect(await prisma.message.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('messages need a login', async () => {
    expect((await fetch(`${base}/api/projects/${project.id}/messages`)).status).toBe(401);
  });
});
