import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { RunsService } from '../runs/runs.service.js';
import type { VersionInfo } from '../versions/versions.service.js';
import { EditsService } from './edits.service.js';

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ID_MESSAGE = 'element ids contain only letters, digits, "_" and "-"';

export class ElementEditDto {
  @Matches(ID, { message: ID_MESSAGE })
  id: string;

  @IsString()
  @Length(1, 2000)
  prompt: string;
}

export class MoveDto {
  @Matches(ID, { message: ID_MESSAGE })
  id: string;

  /** null = directly inside <body> */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID, { message: ID_MESSAGE })
  parentId: string | null = null;

  /** null = at the end of the parent */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID, { message: ID_MESSAGE })
  beforeId: string | null = null;
}

export class OffsetDto {
  @Matches(ID, { message: ID_MESSAGE })
  id: string;

  @Type(() => Number)
  @IsInt()
  @Min(-5000)
  @Max(5000)
  dx: number;

  @Type(() => Number)
  @IsInt()
  @Min(-5000)
  @Max(5000)
  dy: number;
}

@Controller('projects/:id/edits')
export class EditsController {
  constructor(
    private readonly edits: EditsService,
    private readonly runs: RunsService,
  ) {}

  /** Change one element by prompt (Hermes, aba-edit-element). 202 + a run to follow, like a build. */
  @Post('element')
  @HttpCode(202)
  element(@Req() req: AuthedRequest, @Param('id') projectId: string, @Body() body: ElementEditDto) {
    return this.runs.startEdit(req.user!.id, projectId, body.id, body.prompt);
  }

  /** Drag: move one element. No model call. */
  @Post('move')
  move(@Req() req: AuthedRequest, @Param('id') projectId: string, @Body() body: MoveDto): Promise<VersionInfo> {
    return this.edits.move(req.user!.id, projectId, body.id, body.parentId ?? null, body.beforeId ?? null);
  }

  /** Alt-drag: nudge one element by pixels. No model call. */
  @Post('offset')
  offset(@Req() req: AuthedRequest, @Param('id') projectId: string, @Body() body: OffsetDto): Promise<VersionInfo> {
    return this.edits.offset(req.user!.id, projectId, body.id, body.dx, body.dy);
  }
}
