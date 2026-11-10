import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FRIENDLY } from '../src/runs/runs.service.js';
import { FakeHermes } from './fake-hermes.js';

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Projects and runs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const hermes = new FakeHermes();
  const ws = mkdtempSync(path.join(tmpdir(), 'aba-ws-'));
  const stamp = Date.now();
  // Two users, logged in once: login is limited to 5 attempts per minute (Step 6).
  let owner: string;
  let other: string;

  async function login(name: string): Promise<string> {
    const creds = { username: `e2e-${name}-${stamp}`, password: 'a long password' };
    await fetch(`${base}/api/auth/register`, post(creds));
    const res = await fetch(`${base}/api/auth/login`, post(creds));
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  function post(body: unknown, cookie?: string): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    };
  }
  async function createProject(cookie: string, name = 'Coffee shop') {
    const res = await fetch(`${base}/api/projects`, post({ name }, cookie));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; name: string };
  }
  /** Reads the browser-facing SSE stream until the run reaches a final status. */
  async function collect(cookie: string, runId: string) {
    const res = await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text(); // the stream closes when the run is over
    return text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)));
  }

  beforeAll(async () => {
    await hermes.start();
    process.env.HERMES_URL = hermes.url;
    process.env.HERMES_API_KEY = 'test-hermes-key';
    process.env.WORKSPACES_DIR = ws;
    process.env.RUN_TIMEOUT_MS = '800';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    owner = await login('owner');
    other = await login('other');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
    await hermes.stop();
    rmSync(ws, { recursive: true, force: true });
  });

  it('creates a project folder with a git repo whose first commit is "init"', async () => {
    const cookie = owner;
    const project = await createProject(cookie);
    const dir = path.join(ws, project.id);
    expect(existsSync(dir)).toBe(true);
    const log = execFileSync('git', ['-C', dir, 'log', '--oneline'], { encoding: 'utf8' });
    expect(log.trim()).toMatch(/^[0-9a-f]+ init$/);

    const list = await (await fetch(`${base}/api/projects`, { headers: { Cookie: cookie } })).json();
    expect(list.map((p: { id: string }) => p.id)).toContain(project.id);
  });

  it("answers 404 for another user's project, and for ids that are not UUIDs", async () => {
    const project = await createProject(owner);
    expect((await fetch(`${base}/api/projects/${project.id}`, { headers: { Cookie: owner } })).status).toBe(200);
    expect((await fetch(`${base}/api/projects/${project.id}`, { headers: { Cookie: other } })).status).toBe(404);
    expect((await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'x' }, other))).status).toBe(404);
    expect((await fetch(`${base}/api/projects/..%2F..%2Fetc`, { headers: { Cookie: owner } })).status).toBe(404);
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
  });

  it('starts a run with 202 quickly, tells Hermes the /workspaces path, and streams progress', async () => {
    hermes.script = 'complete';
    const cookie = owner;
    const project = await createProject(cookie);
    const t0 = Date.now();
    const res = await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'A bakery page' }, cookie));
    expect(res.status).toBe(202);
    expect(Date.now() - t0).toBeLessThan(3000);
    const { runId } = await res.json();

    const events = await collect(cookie, runId);
    const types = events.map((e) => e.type);
    expect(types).toContain('run.started');
    expect(types).toContain('tool.started');
    expect(events.at(-1)).toMatchObject({ type: 'run.status', status: 'completed', text: 'Built it.' });

    const started = hermes.calls.find((c) => c.path === '/v1/runs' && c.body.session_id === project.id)!;
    expect(started.body.input).toBe('A bakery page');
    expect(started.body.instructions).toBe(`Work only inside /workspaces/${project.id}.`);
    const row = await prisma.run.findUnique({ where: { id: runId } });
    expect(row).toMatchObject({ status: 'completed', prompt: 'A bakery page' });
    expect(row!.hermesRunId).toMatch(/^run_/);

    expect((await fetch(`${base}/api/runs/${runId}/events`, { headers: { Cookie: other } })).status).toBe(404);
  });

  it('refuses a second run on a busy project with 409', async () => {
    hermes.script = 'slow';
    const cookie = owner;
    const project = await createProject(cookie);
    const first = await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'one' }, cookie));
    expect(first.status).toBe(202);
    const second = await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'two' }, cookie));
    expect(second.status).toBe(409);
    await collect(cookie, (await first.json()).runId);
    const third = await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'three' }, cookie));
    expect(third.status).toBe(202);
    await collect(cookie, (await third.json()).runId);
  });

  it('answers every approval request with "deny"', async () => {
    hermes.script = 'approval';
    const cookie = owner;
    const project = await createProject(cookie);
    const { runId } = await (await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'x' }, cookie))).json();
    const events = await collect(cookie, runId);
    expect(events.map((e) => e.type)).toContain('approval.denied');
    const approval = hermes.calls.find((c) => c.path.endsWith('/approval'))!;
    expect(approval.body).toEqual({ choice: 'deny', request_id: 'req-1' });
  });

  it('stops a run that takes too long', async () => {
    hermes.script = 'hang';
    const cookie = owner;
    const project = await createProject(cookie);
    const { runId } = await (await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'x' }, cookie))).json();
    const events = await collect(cookie, runId);
    expect(events.at(-1)).toMatchObject({ status: 'timeout', text: FRIENDLY.timeout });
    expect(hermes.calls.some((c) => c.path.endsWith('/stop'))).toBe(true);
  });

  it('fails with a friendly message when Hermes is not running', async () => {
    const saved = process.env.HERMES_URL;
    process.env.HERMES_URL = 'http://127.0.0.1:1'; // nothing listens here
    try {
      const cookie = owner;
      const project = await createProject(cookie);
      const res = await fetch(`${base}/api/projects/${project.id}/runs`, post({ prompt: 'x' }, cookie));
      expect(res.status).toBe(202);
      const events = await collect(cookie, (await res.json()).runId);
      expect(events.at(-1)).toMatchObject({ status: 'failed', text: FRIENDLY.unavailable });
    } finally {
      process.env.HERMES_URL = saved;
    }
  });
});
