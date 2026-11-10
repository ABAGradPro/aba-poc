import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Project } from '../generated/prisma/client.js';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { CreateProjectDto } from './project.dto.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateProjectDto): Promise<Project> {
    return this.projects.create(req.user!.id, body.name);
  }

  @Get()
  list(@Req() req: AuthedRequest): Promise<Project[]> {
    return this.projects.list(req.user!.id);
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string): Promise<Project> {
    return this.projects.getOwned(req.user!.id, id);
  }
}
