import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export type Script = 'complete' | 'approval' | 'slow' | 'hang' | 'nopage';

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
          // Like Hermes, write into the folder named in the prompt ("Workspace: /workspaces/<folder>").
          const folder = /Workspace: \/workspaces\/([a-z0-9-]+)/.exec(String(body?.input ?? ''))?.[1];
          if (this.workspaces && this.script !== 'nopage' && folder) {
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
            send({ event: 'run.completed', output: 'Built it.' });
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

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
