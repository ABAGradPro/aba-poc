import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import express, { type Request, type Response } from 'express';
import { readFile, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { hostPath, isUuid } from '../projects/workspace.js';

export const EDIT_MODE_TAG = '<script src="/__aba/edit-mode.js" defer></script>';

/** Filled in by Step 9 (click-to-edit). For now it only announces itself. */
const EDIT_MODE_JS = `// ABA edit mode (Step 9 adds click-to-edit here)
window.__abaEditMode = { ready: true };
`;

/** Adds the edit-mode script right before </body> (or at the end if there is none). */
export function injectEditMode(html: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + EDIT_MODE_TAG + html.slice(i) : html + EDIT_MODE_TAG;
}

/**
 * The preview server (guide, Step 8): a second small app on 127.0.0.1:4000.
 * It is a different origin from the GUI (5173), so generated code can never
 * reach the user's session. It serves /p/<projectId>/ from that project's folder and
 * never serves dotfiles such as .git.
 */
@Injectable()
export class PreviewServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewServer.name);
  private server?: Server;
  url = '';

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): Promise<void> {
    const port = Number(process.env.PREVIEW_PORT ?? 4000);
    const app = express();
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store'); // a reload always shows the newest version
      next();
    });
    app.get('/__aba/edit-mode.js', (_req, res) => {
      res.type('application/javascript').send(EDIT_MODE_JS);
    });
    app.use((req, res) => void this.serve(req, res));

    return new Promise((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => {
        this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        this.logger.log(`Preview server on ${this.url}`);
        resolve();
      });
      server.on('error', reject);
      this.server = server;
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server!.close(() => r()));
  }

  private async serve(req: Request, res: Response): Promise<void> {
    const notFound = () => void res.status(404).type('text/plain').send('Not found');
    // /p/<uuid>/<file path>
    const m = /^\/p\/([^/]+)(\/.*)?$/.exec(req.path);
    if (!m || !isUuid(m[1])) return notFound();
    if (m[2] === undefined) {
      res.redirect(301, `/p/${m[1]}/`);
      return;
    }

    let rel: string;
    try {
      rel = decodeURIComponent(m[2]);
    } catch {
      return notFound();
    }
    const segments = rel.split('/').filter(Boolean);
    // No dotfiles or dot-folders (.git, .env, ..) and no backslashes or NUL bytes.
    if (segments.some((s) => s.startsWith('.') || s.includes('\\') || s.includes('\0'))) {
      return notFound();
    }

    // The address uses the id (it never changes); the folder follows the project's name.
    const project = await this.prisma.project.findUnique({ where: { id: m[1] }, select: { folder: true } });
    if (!project) return notFound();
    const root = hostPath(project.folder);
    let file = path.join(root, ...segments);
    if (file !== root && !file.startsWith(root + path.sep)) return notFound();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      if (!(await stat(file)).isFile()) return notFound();
    } catch {
      return notFound();
    }

    if (file.toLowerCase().endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      res.type('text/html').send(injectEditMode(html));
      return;
    }
    res.sendFile(file, { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) notFound();
    });
  }
}
