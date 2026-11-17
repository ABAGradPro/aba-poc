import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import express, { type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { MessagesService } from '../messages/messages.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hostPath, isUuid } from '../projects/workspace.js';

export const EDIT_MODE_TAG = '<script src="/__aba/edit-mode.js" defer></script>';

/** The GUI's origin: the only page edit mode will listen to and talk to. */
const GUI_ORIGIN = process.env.GUI_ORIGIN ?? 'http://localhost:5173';

/** The edit-mode bundle from packages/edit-mode (built with esbuild), with the GUI origin filled in. */
function loadEditMode(log: Logger): string {
  try {
    const pkg = createRequire(import.meta.url).resolve('@aba/edit-mode/package.json');
    const js = readFileSync(path.join(path.dirname(pkg), 'dist', 'edit-mode.js'), 'utf8');
    return js.replaceAll('__ABA_PARENT_ORIGIN__', GUI_ORIGIN);
  } catch (err) {
    log.warn(`Edit mode is not built (pnpm --filter @aba/edit-mode build): ${String(err)}`);
    return '/* ABA edit mode is not built */';
  }
}

/** Adds the edit-mode script right before </body> (or at the end if there is none). */
export function injectEditMode(html: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + EDIT_MODE_TAG + html.slice(i) : html + EDIT_MODE_TAG;
}

/**
 * The preview server (guide, Step 8): a second small app on 127.0.0.1:4000.
 * It is a different origin from the GUI (5173), so generated code can never
 * reach the user's session. It serves /p/<projectId>/ from that project's folder and
 * never serves dotfiles such as .git. Contact forms of the page post to
 * /p/<projectId>/__aba/contact, which saves a Message for the project's owner.
 */
@Injectable()
export class PreviewServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewServer.name);
  private server?: Server;
  url = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  onModuleInit(): Promise<void> {
    const port = Number(process.env.PREVIEW_PORT ?? 4000);
    const app = express();
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store'); // a reload always shows the newest version
      next();
    });
    const editMode = loadEditMode(this.logger);
    app.get('/__aba/edit-mode.js', (_req, res) => {
      res.type('application/javascript').send(editMode);
    });
    // Contact forms of generated pages post here: same origin as the page, so no CORS, no
    // login and no cookies are involved. Only small JSON bodies are read.
    app.post(/^\/p\/([^/]+)\/__aba\/contact$/, express.json({ limit: '10kb' }), (req, res) => {
      const codes = { saved: 201, invalid: 400, 'too-many': 429, 'no-project': 404 } as const;
      this.messages.save(String(req.params[0]), req.body).then(
        (result) => void res.status(codes[result]).json({ ok: result === 'saved' }),
        (err) => {
          this.logger.error(`Could not save a contact message: ${String(err)}`);
          res.status(500).json({ ok: false });
        },
      );
    });
    app.use((req, res) => void this.serve(req, res));
    // A body that is not valid JSON, or too large.
    app.use((_err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
      if (!res.headersSent) res.status(400).json({ ok: false });
    });

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
