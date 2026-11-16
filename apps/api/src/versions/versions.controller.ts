import { Controller, Get, Param, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { VersionsService, type VersionInfo } from './versions.service.js';

@Controller('projects/:id/versions')
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Param('id') projectId: string): Promise<VersionInfo[]> {
    return this.versions.list(req.user!.id, projectId);
  }
}
