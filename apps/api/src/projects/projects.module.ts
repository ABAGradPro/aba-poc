import { Module } from '@nestjs/common';
import { HermesClient } from '../hermes/hermes.client.js';
import { RunsController } from '../runs/runs.controller.js';
import { RunsService } from '../runs/runs.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { VersionsController } from '../versions/versions.controller.js';
import { VersionsService } from '../versions/versions.service.js';
import { PreviewServer } from '../preview/preview.server.js';
import { EditsController } from '../edits/edits.controller.js';
import { EditsService } from '../edits/edits.service.js';
import { PublishController } from '../publish/publish.controller.js';

@Module({
  controllers: [ProjectsController, RunsController, VersionsController, EditsController, PublishController],
  providers: [ProjectsService, RunsService, HermesClient, VersionsService, PreviewServer, EditsService],
  exports: [ProjectsService, RunsService],
})
export class ProjectsModule {}
