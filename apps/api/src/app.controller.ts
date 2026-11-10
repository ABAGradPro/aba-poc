import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.constants.js';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
