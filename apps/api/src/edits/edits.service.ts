import { BadRequestException, Injectable } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectsService } from '../projects/projects.service.js';
import { hostPath } from '../projects/workspace.js';
import { OVERRIDES } from '../versions/tidy.js';
import { VersionsService, type VersionInfo } from '../versions/versions.service.js';
import { applyOffset, EditError, moveElement } from './html-edits.js';

/** Drag-and-drop edits (guide, Step 9): no model call, just a precise change and a commit. */
@Injectable()
export class EditsService {
  /** One change at a time per project, so two quick drags cannot interleave their commits. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly projects: ProjectsService,
    private readonly versions: VersionsService,
  ) {}

  /** Drag: move one element in index.html and commit "move: <id>". */
  move(userId: string, projectId: string, id: string, parentId: string | null, beforeId: string | null) {
    return this.change(userId, projectId, async (dir) => {
      const index = path.join(dir, 'index.html');
      const html = await this.read(index);
      await writeFile(index, moveElement(html, id, parentId, beforeId));
      return { kind: 'move', summary: `move: ${id}` };
    });
  }

  /** Alt-drag: write or update the one rule for this element in aba-overrides.css; commit "offset: <id>". */
  offset(userId: string, projectId: string, id: string, dx: number, dy: number) {
    return this.change(userId, projectId, async (dir) => {
      await this.read(path.join(dir, 'index.html'));
      const file = path.join(dir, OVERRIDES);
      const css = await readFile(file, 'utf8').catch(() => '/* ABA overrides: written by drag-and-drop edits */\n');
      await writeFile(file, applyOffset(css, id, dx, dy).css);
      return { kind: 'offset', summary: `offset: ${id}` };
    });
  }

  private async read(file: string): Promise<string> {
    const html = await readFile(file, 'utf8').catch(() => null);
    if (html === null) throw new BadRequestException('Build the app first, then edit it.');
    return html;
  }

  private async change(
    userId: string,
    projectId: string,
    apply: (dir: string) => Promise<{ kind: string; summary: string }>,
  ): Promise<VersionInfo> {
    const project = await this.projects.getOwned(userId, projectId);
    const previous = this.locks.get(project.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.projects.assertIdle(project.id, 'edited');
        try {
          const { kind, summary } = await apply(hostPath(project.folder));
          return await this.versions.commitChange(project.id, project.folder, kind, summary);
        } catch (err) {
          if (err instanceof EditError) throw new BadRequestException(err.message);
          throw err;
        }
      });
    this.locks.set(project.id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(project.id) === next) this.locks.delete(project.id);
    }
  }
}
