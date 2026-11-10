import { Body, Controller, HttpCode, Param, Post, Req, Sse, type MessageEvent } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { StartRunDto } from '../projects/project.dto.js';
import { RunsService } from './runs.service.js';

@Controller()
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  /** Answers 202 with the run id immediately; progress arrives on the events stream. */
  @Post('projects/:id/runs')
  @HttpCode(202)
  start(
    @Req() req: AuthedRequest,
    @Param('id') projectId: string,
    @Body() body: StartRunDto,
  ): Promise<{ runId: string }> {
    return this.runs.start(req.user!.id, projectId, body.prompt);
  }

  /** Server-Sent Events: one message per step of the run. */
  @Sse('runs/:id/events')
  async events(@Req() req: AuthedRequest, @Param('id') runId: string): Promise<Observable<MessageEvent>> {
    const stream = await this.runs.events(req.user!.id, runId);
    return stream.pipe(map((data) => ({ data })));
  }
}
