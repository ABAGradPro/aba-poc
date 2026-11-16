import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { EditsService } from '../edits/edits.service.js';
import { VersionsService, type VersionInfo } from './versions.service.js';

@Controller('projects/:id/versions')
export class VersionsController {
  constructor(
    private readonly versions: VersionsService,
    private readonly edits: EditsService,
  ) {}

  /** The newest three versions, newest first. */
  @Get()
  list(@Req() req: AuthedRequest, @Param('id') projectId: string): Promise<VersionInfo[]> {
    return this.versions.list(req.user!.id, projectId);
  }

  /** Go back to one of them. The restore is itself a new version (so it can be undone). */
  @Post(':versionId/restore')
  restore(
    @Req() req: AuthedRequest,
    @Param('id') projectId: string,
    @Param('versionId') versionId: string,
  ): Promise<VersionInfo> {
    return this.edits.restore(req.user!.id, projectId, versionId);
  }
}
