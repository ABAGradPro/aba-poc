import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Length, Matches } from 'class-validator';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { RunsService } from '../runs/runs.service.js';

export class PublishDto {
  /** The address part: http://<droplet>/<slug>/ */
  @Length(1, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'the address may only use lowercase letters, digits and single hyphens (e.g. amman-coffee)',
  })
  slug: string;
}

/** Publish and roll back (guide, Step 11). Both are Hermes runs, followed like a build. */
@Controller('projects/:id')
export class PublishController {
  constructor(private readonly runs: RunsService) {}

  @Post('publish')
  @HttpCode(202)
  publish(@Req() req: AuthedRequest, @Param('id') projectId: string, @Body() body: PublishDto) {
    return this.runs.startPublish(req.user!.id, projectId, body.slug);
  }

  @Post('rollback')
  @HttpCode(202)
  rollback(@Req() req: AuthedRequest, @Param('id') projectId: string) {
    return this.runs.startRollback(req.user!.id, projectId);
  }
}
