import { Controller, Delete, Get, HttpCode, Param, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { MessagesService, type MessageInfo } from './messages.service.js';

/** The owner's view of what visitors sent through the project's contact forms. */
@Controller('projects/:id/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Param('id') id: string): Promise<MessageInfo[]> {
    return this.messages.list(req.user!.id, id);
  }

  @Delete(':messageId')
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ): Promise<void> {
    return this.messages.remove(req.user!.id, id, messageId);
  }
}
