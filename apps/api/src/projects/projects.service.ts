import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import type { Project } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hostPath, isUuid } from './workspace.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the row, then the folder and a git repo with a first commit "init". */
  async create(ownerId: string, name: string): Promise<Project> {
    const project = await this.prisma.project.create({
      data: { name: name.trim(), ownerId },
    });
    const dir = hostPath(project.id);
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
}
