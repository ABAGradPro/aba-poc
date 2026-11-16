import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cheerio from 'cheerio';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PreviewServer } from '../src/preview/preview.server.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FRIENDLY } from '../src/runs/runs.service.js';
import { FakeHermes } from './fake-hermes.js';

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Generation, versions and preview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let preview: string;
  let cookie: string;
  const hermes = new FakeHermes();
  const ws = mkdtempSync(path.join(tmpdir(), 'aba-ws-'));
  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

  async function generate(prompt: string) {
    const project = await (await fetch(`${base}/api/projects`, json({ name: 'Bakery' }))).json();
    const { runId } = await (await fetch(`${base}/api/projects/${project.id}/runs`, json({ prompt }))).json();
    const text = await (await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: cookie } })).text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)));
    return { project: project as { id: string; folder: string }, events };
  }

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
    const creds = { username: `e2e-preview-${Date.now()}`, password: 'a long password' };
    await fetch(`${base}/api/auth/register`, { ...json(creds), headers: { 'Content-Type': 'application/json' } });
    const login = await fetch(`${base}/api/auth/login`, {
      ...json(creds),
      headers: { 'Content-Type': 'application/json' },
    });
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    rmSync(ws, { recursive: true, force: true });
  });

  it('asks Hermes to use the aba-generate-spa skill with the /workspaces path', async () => {
    hermes.script = 'complete';
    const { project } = await generate('A bakery page');
    const call = hermes.calls.find((c) => c.path === '/v1/runs' && c.body.session_id === project.id)!;
    expect(call.body.input).toBe(
      `Use the aba-generate-spa skill.\nWorkspace: /workspaces/${project.folder}\nRequest: A bakery page`,
    );
  });

  it('tidies the page, commits "generate: <prompt>" and saves version 1', async () => {
    hermes.script = 'complete';
    const { project, events } = await generate('A bakery page');
    const created = events.find((e) => e.type === 'version.created');
    expect(created.version).toMatchObject({ number: 1, kind: 'generate', summary: 'generate: A bakery page' });
    expect(events.at(-1)).toMatchObject({ status: 'completed' });

    const dir = path.join(ws, project.folder);
    const $ = cheerio.load(readFileSync(path.join(dir, 'index.html'), 'utf8'));
    expect($('body *').filter((_, el) => !$(el).attr('data-aba-id')).length).toBe(0);
    expect($('link[rel="stylesheet"]').last().attr('href')).toBe('aba-overrides.css');
    expect(readFileSync(path.join(dir, 'aba-overrides.css'), 'utf8')).toContain('ABA overrides');

    const log = execFileSync('git', ['-C', dir, 'log', '--format=%H %s'], { encoding: 'utf8' }).trim().split('\n');
    expect(log[0]).toMatch(/^[0-9a-f]{40} generate: A bakery page$/);
    expect(log[1]).toMatch(/ init$/);
    expect(created.version.commitSha).toBe(log[0].split(' ')[0]);
    expect(execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');

    const versions = await (await fetch(`${base}/api/projects/${project.id}/versions`, { headers: { Cookie: cookie } })).json();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ number: 1, summary: 'generate: A bakery page' });
  });

  it('saves no version and explains why when Hermes made no page', async () => {
    hermes.script = 'nopage';
    const { project, events } = await generate('Something vague');
    expect(events.at(-1)).toMatchObject({ status: 'failed', text: FRIENDLY.noPage });
    expect(await prisma.version.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('serves the project on the preview origin with the edit-mode script added', async () => {
    hermes.script = 'complete';
    const { project } = await generate('A bakery page');
    const res = await fetch(`${preview}/p/${project.id}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Fake bakery');
    expect(html).toMatch(/<script src="\/__aba\/edit-mode\.js" defer><\/script><\/body>/);
    expect((await fetch(`${preview}/p/${project.id}/styles.css`)).status).toBe(200);
    expect((await fetch(`${preview}/__aba/edit-mode.js`)).status).toBe(200);
    expect((await fetch(`${preview}/p/${project.id}`, { redirect: 'manual' })).status).toBe(301);
  });

  it('never serves .git or other dotfiles, and refuses paths outside the project', async () => {
    hermes.script = 'complete';
    const { project } = await generate('A bakery page');
    for (const p of [
      `/p/${project.id}/.git/config`,
      `/p/${project.id}/.git/HEAD`,
      `/p/${project.id}/%2e%2e/%2e%2e/etc/passwd`,
      `/p/${project.id}/..%2f..%2fetc%2fpasswd`,
      `/p/not-a-uuid/`,
      `/p/${project.id}/missing.html`,
    ]) {
      expect((await fetch(`${preview}${p}`)).status, p).toBe(404);
    }
  });
});
