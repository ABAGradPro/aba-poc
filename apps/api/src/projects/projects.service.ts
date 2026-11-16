import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { Project } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { folderFor, hostPath, isUuid, trashRoot } from './workspace.js';

const ACTIVE_RUN = { in: ['queued', 'running'] };

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Creates the row, then the folder (named after the project) and a git repo with a first commit "init". */
  async create(ownerId: string, name: string): Promise<Project> {
    const id = randomUUID();
    const clean = name.trim();
    const project = await this.prisma.project.create({
      data: { id, name: clean, ownerId, folder: folderFor(clean, id) },
    });
    const dir = hostPath(project.folder);
    try {
      await mkdir(dir, { recursive: false });
      const git = simpleGit(dir);
      await git.init();
      await git.addConfig('user.name', 'ABA');
      await git.addConfig('user.email', 'aba@localhost');
      await git.commit('init', [], { '--allow-empty': null });
    } catch (err) {
      // Never leave a project row without its folder.
      await rm(dir, { recursive: true, force: true });
      await this.prisma.project.delete({ where: { id: project.id } });
      throw err;
    }
    return project;
  }

  list(ownerId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The project if it belongs to this user; otherwise 404, so others cannot tell it exists. */
  async getOwned(ownerId: string, id: string): Promise<Project> {
    if (!isUuid(id)) throw new NotFoundException('Project not found');
    const project = await this.prisma.project.findFirst({
      where: { id, ownerId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /** Renames the project and its folder. Refused while the project is being built. */
  async rename(ownerId: string, id: string, name: string): Promise<Project> {
    const project = await this.getOwned(ownerId, id);
    await this.assertIdle(project.id, 'renamed');
    const clean = name.trim();
    const folder = folderFor(clean, project.id);
    if (folder === project.folder) {
      return this.prisma.project.update({ where: { id: project.id }, data: { name: clean } });
    }
    const from = hostPath(project.folder);
    const to = hostPath(folder);
    await rename(from, to);
    try {
      return await this.prisma.project.update({
        where: { id: project.id },
        data: { name: clean, folder },
      });
    } catch (err) {
      await rename(to, from); // keep the folder and the database in step
      throw err;
    }
  }

  /**
   * Deletes the project, its versions and runs. The folder is moved to the trash
   * (~/aba-data/trash), not erased, so it can still be recovered by hand.
   */
  async remove(ownerId: string, id: string): Promise<void> {
    const project = await this.getOwned(ownerId, id);
    await this.assertIdle(project.id, 'deleted');
    const from = hostPath(project.folder);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const to = path.join(trashRoot(), `${project.folder}-${stamp}`);
    await mkdir(trashRoot(), { recursive: true });
    let moved = false;
    try {
      await rename(from, to);
      moved = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; // folder already gone
    }
    try {
      await this.prisma.project.delete({ where: { id: project.id } });
    } catch (err) {
      if (moved) await rename(to, from);
      throw err;
    }
    this.logger.log(`Deleted project ${project.id}; folder moved to ${moved ? to : '(none)'}`);
  }

  /** 409 while a build or prompt edit is running for this project. */
  async assertIdle(projectId: string, action: string): Promise<void> {
    const busy = await this.prisma.run.findFirst({
      where: { projectId, status: ACTIVE_RUN },
    });
    if (busy) {
      throw new ConflictException(
        `This project is being built right now and cannot be ${action}. Please wait for the build to finish.`,
      );
    }
  }
}
