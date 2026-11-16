import { Injectable, Logger } from '@nestjs/common';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { Version } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { hostPath } from '../projects/workspace.js';
import { OVERRIDES, tidyHtml } from './tidy.js';

export interface VersionInfo {
  id: string;
  number: number; // 1 for the first version of the project, 2 for the next, ...
  kind: string;
  summary: string;
  commitSha: string;
  createdAt: Date;
}

const short = (s: string, max = 72) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

@Injectable()
export class VersionsService {
  private readonly logger = new Logger(VersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private exists(file: string): Promise<boolean> {
    return access(file).then(
      () => true,
      () => false,
    );
  }

  /**
   * After a successful generation: tidy index.html, make sure aba-overrides.css exists,
   * commit "generate: <prompt>" and save a Version row.
   * Returns null when there is no index.html (nothing to save).
   */
  async saveGeneration(projectId: string, folder: string, prompt: string): Promise<VersionInfo | null> {
    const dir = hostPath(folder);
    const index = path.join(dir, 'index.html');
    if (!(await this.exists(index))) return null;

    const before = await readFile(index, 'utf8');
    const { html, addedIds } = tidyHtml(before);
    if (html !== before) await writeFile(index, html);
    if (addedIds) this.logger.log(`Project ${projectId}: added ${addedIds} missing data-aba-id(s)`);

    const overrides = path.join(dir, OVERRIDES);
    if (!(await this.exists(overrides))) {
      await writeFile(overrides, '/* ABA overrides: written by drag-and-drop edits */\n');
    }

    const git = simpleGit(dir);
    await git.add(['-A']);
    const summary = `generate: ${short(prompt.trim().replace(/\s+/g, ' '))}`;
    await git.commit(summary, [], { '--allow-empty': null });
    const commitSha = (await git.revparse(['HEAD'])).trim();

    const version = await this.prisma.version.create({
      data: { projectId, commitSha, kind: 'generate', summary },
    });
    return this.withNumber(version);
  }

  /** The owner's versions, newest first. */
  async list(userId: string, projectId: string): Promise<VersionInfo[]> {
    const project = await this.projects.getOwned(userId, projectId);
    const rows = await this.prisma.version.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((v, i) => ({ ...this.pick(v), number: i + 1 })).reverse();
  }

  private async withNumber(v: Version): Promise<VersionInfo> {
    const number = await this.prisma.version.count({
      where: { projectId: v.projectId, createdAt: { lte: v.createdAt } },
    });
    return { ...this.pick(v), number };
  }

  private pick(v: Version): Omit<VersionInfo, 'number'> {
    return {
      id: v.id,
      kind: v.kind,
      summary: v.summary,
      commitSha: v.commitSha,
      createdAt: v.createdAt,
    };
  }
}
