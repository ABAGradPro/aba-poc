import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { Version } from '../generated/prisma/client.js';
import { pruneStock } from '../images/images.store.js';
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

/** How many Version rows each project keeps (guide, Step 10). Git keeps every commit. */
export const KEEP_VERSIONS = 3;

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

    const removed = await pruneStock(dir);
    if (removed.length) this.logger.log(`Project ${projectId}: removed ${removed.length} unused stock photo(s)`);
    const summary = `generate: ${short(prompt.trim().replace(/\s+/g, ' '))}`;
    return this.commitChange(projectId, folder, 'generate', summary);
  }

  /**
   * The same final step for every change (build, prompt edit, move, offset): tidy index.html
   * (ids, overrides linked last), make sure aba-overrides.css exists, commit and save a Version.
   */
  async commitChange(projectId: string, folder: string, kind: string, summary: string): Promise<VersionInfo> {
    const dir = hostPath(folder);
    const index = path.join(dir, 'index.html');
    if (await this.exists(index)) {
      const before = await readFile(index, 'utf8');
      const { html, addedIds } = tidyHtml(before);
      if (html !== before) await writeFile(index, html);
      if (addedIds) this.logger.log(`Project ${projectId}: added ${addedIds} missing data-aba-id(s)`);
    }

    const overrides = path.join(dir, OVERRIDES);
    if (!(await this.exists(overrides))) {
      await writeFile(overrides, '/* ABA overrides: written by drag-and-drop edits */\n');
    }

    const git = simpleGit(dir);
    await git.add(['-A']);
    await git.commit(summary, [], { '--allow-empty': null });
    const commitSha = (await git.revparse(['HEAD'])).trim();

    // Next number, save the row, then trim this project's rows to the newest three.
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.version.findFirst({ where: { projectId }, orderBy: { number: 'desc' } });
      const created = await tx.version.create({
        data: { projectId, commitSha, kind, summary, number: (last?.number ?? 0) + 1 },
      });
      const keep = await tx.version.findMany({
        where: { projectId },
        orderBy: { number: 'desc' },
        take: KEEP_VERSIONS,
        select: { id: true },
      });
      await tx.version.deleteMany({ where: { projectId, id: { notIn: keep.map((k) => k.id) } } });
      return created;
    });
    return this.pick(version);
  }

  /**
   * Go back to one of the newest three versions (guide, Step 10): restore every file from
   * that commit, then commit "restore: <sha>" as a new version, so the restore can be undone too.
   * The caller checks ownership and that no build is running.
   */
  async restore(projectId: string, folder: string, versionId: string): Promise<VersionInfo> {
    const shown = await this.prisma.version.findMany({
      where: { projectId },
      orderBy: { number: 'desc' },
      take: KEEP_VERSIONS,
    });
    const target = shown.find((v) => v.id === versionId);
    if (!target) throw new NotFoundException('That version is not one of the last three.');
    const git = simpleGit(hostPath(folder));
    await git.raw(['restore', `--source=${target.commitSha}`, '--staged', '--worktree', '--', '.']);
    const sha = target.commitSha.slice(0, 7);
    return this.commitChange(projectId, folder, 'restore', `restore: ${sha} (version ${target.number})`);
  }

  /** The owner's newest three versions, newest first. */
  async list(userId: string, projectId: string): Promise<VersionInfo[]> {
    const project = await this.projects.getOwned(userId, projectId);
    const rows = await this.prisma.version.findMany({
      where: { projectId: project.id },
      orderBy: { number: 'desc' },
      take: KEEP_VERSIONS,
    });
    return rows.map((v) => this.pick(v));
  }

  private pick(v: Version): VersionInfo {
    return {
      id: v.id,
      number: v.number,
      kind: v.kind,
      summary: v.summary,
      commitSha: v.commitSha,
      createdAt: v.createdAt,
    };
  }
}
