import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export type Script = 'complete' | 'approval' | 'slow' | 'hang' | 'nopage' | 'edit' | 'release' | 'verifyfail';

/** The page the fake Hermes "builds": the <p> and <script> have no data-aba-id on purpose. */
export const FAKE_PAGE =
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head>' +
  '<body><main data-aba-id="main"><h1 data-aba-id="title">Fake bakery</h1><p>Fresh bread</p></main>' +
  '<script src="app.js"></script></body></html>';

/** A stand-in for the Hermes Runs API, so tests are fast, free and need no model. */
export class FakeHermes {
  script: Script = 'complete';
  readonly calls: { method: string; path: string; body: any }[] = [];
  private server!: Server;
  url = '';
  /** Where projects live, so a run can write files like the real Hermes does. */
  workspaces = '';
  /** What the fake answers for script 'edit' (the aba-edit-element JSON). */
  editReply = '';
  /** A folder standing in for the droplet's /var/www/apps (served by a test web server). */
  droplet = '';
  /** Every release per slug, oldest first, like /var/www/releases/<slug>/. */
  readonly releases = new Map<string, string[]>();
  private output = 'Built it.';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        this.calls.push({ method: req.method!, path: req.url!, body });
        if (req.headers.authorization !== 'Bearer test-hermes-key') {
          res.writeHead(401).end();
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/runs') {
          this.output = this.script === 'edit' ? this.editReply : 'Built it.';
          this.release(String(body?.input ?? ''));
          // Like Hermes, write into the folder named in the prompt ("Workspace: /workspaces/<folder>").
          const folder = /Workspace: \/workspaces\/([a-z0-9-]+)/.exec(String(body?.input ?? ''))?.[1];
          if (this.workspaces && !['nopage', 'edit', 'release', 'verifyfail'].includes(this.script) && folder) {
            const dir = path.join(this.workspaces, folder);
            mkdirSync(dir, { recursive: true });
            writeFileSync(path.join(dir, 'index.html'), FAKE_PAGE);
            writeFileSync(path.join(dir, 'styles.css'), 'body{font-family:sans-serif}');
            writeFileSync(path.join(dir, 'app.js'), '');
          }
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ run_id: `run_${this.calls.length}`, status: 'queued' }));
          return;
        }
        if (req.method === 'GET' && req.url?.endsWith('/events')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const send = (e: object) => res.write(`data: ${JSON.stringify(e)}\n\n`);
          send({ event: 'run.started' });
          send({ event: 'tool.started', tool: 'write_file' });
          if (this.script === 'approval') send({ event: 'approval.request', request_id: 'req-1' });
          if (this.script === 'hang') return; // never finishes
          const finish = () => {
            send({ event: 'tool.completed', tool: 'write_file' });
            send({ event: 'run.completed', output: this.output });
            res.end();
          };
          if (this.script === 'slow') setTimeout(finish, 1500);
          else setTimeout(finish, 50);
          return;
        }
        if (req.method === 'POST' && /\/v1\/runs\/[^/]+\/(approval|stop)$/.test(req.url!)) {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Acts out aba-publish / aba-rollback against the stand-in droplet folder. */
  private release(input: string): void {
    if (!['release', 'verifyfail'].includes(this.script)) return;
    const pub = /aba-publish skill\. Workspace: \/workspaces\/([a-z0-9-]+)\. Slug: ([a-z0-9-]+)\./.exec(input);
    const back = /aba-rollback skill\. Slug: ([a-z0-9-]+)\./.exec(input);
    if (pub && this.script === 'verifyfail') {
      this.output = 'I did not publish it: aba-verify reported FAIL - console: "Uncaught Error: x", source: app.js (20).';
      return;
    }
    if (pub) {
      const [, folder, slug] = pub;
      const html = readFileSync(path.join(this.workspaces, folder, 'index.html'), 'utf8');
      const list = [...(this.releases.get(slug) ?? []), html].slice(-3); // keep three, like the skill
      this.releases.set(slug, list);
      this.serve(slug, html);
      this.output = `The project has been published to http://droplet/${slug}/.`;
    } else if (back) {
      const slug = back[1];
      const list = this.releases.get(slug) ?? [];
      if (list.length < 2) {
        this.output = 'There is no previous release to roll back to.';
        return;
      }
      this.serve(slug, list[list.length - 2]);
      this.output = `Rolled back: the previous version is live at http://droplet/${slug}/.`;
    }
  }

  private serve(slug: string, html: string): void {
    mkdirSync(path.join(this.droplet, slug), { recursive: true });
    writeFileSync(path.join(this.droplet, slug, 'index.html'), html);
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
