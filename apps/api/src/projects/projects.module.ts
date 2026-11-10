import { Module } from '@nestjs/common';
import { HermesClient } from '../hermes/hermes.client.js';
import { RunsController } from '../runs/runs.controller.js';
import { RunsService } from '../runs/runs.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController, RunsController],
  providers: [ProjectsService, RunsService, HermesClient],
  exports: [ProjectsService, RunsService],
})
export class ProjectsModule {}
