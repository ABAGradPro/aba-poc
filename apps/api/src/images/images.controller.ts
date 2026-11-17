import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { ImagesService } from './images.service.js';
import { MAX_CAPTION, MAX_IMAGE_BYTES, type ProjectImage } from './images.store.js';

export class CaptionDto {
  @IsString()
  @MaxLength(MAX_CAPTION)
  caption: string;
}

/** Reads the request body as bytes, stopping as soon as it is larger than the limit. */
function readBody(req: AuthedRequest, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new PayloadTooLargeException('Images can be at most 5 MB each.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

@Controller('projects/:id/images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Param('id') id: string): Promise<ProjectImage[]> {
    return this.images.list(req.user!.id, id);
  }

  /** The image itself is the request body (Content-Type: application/octet-stream). */
  @Post()
  async upload(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('name') name?: string,
    @Query('caption') caption?: string,
  ): Promise<ProjectImage> {
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      throw new BadRequestException('The image needs a file name.');
    }
    if (typeof caption === 'string' && caption.length > MAX_CAPTION) {
      throw new BadRequestException(`Descriptions can be at most ${MAX_CAPTION} characters.`);
    }
    if (Number(req.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Images can be at most 5 MB each.');
    }
    const data = await readBody(req, MAX_IMAGE_BYTES);
    return this.images.upload(req.user!.id, id, name, typeof caption === 'string' ? caption : '', data);
  }

  @Patch(':file')
  setCaption(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('file') file: string,
    @Body() body: CaptionDto,
  ): Promise<ProjectImage> {
    return this.images.setCaption(req.user!.id, id, file, body.caption);
  }

  @Delete(':file')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') id: string, @Param('file') file: string): Promise<void> {
    return this.images.remove(req.user!.id, id, file);
  }
}
