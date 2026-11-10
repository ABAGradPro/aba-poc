import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { CredentialsDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { Public, SESSION_COOKIE, SESSION_MAX_AGE_MS } from './auth.constants.js';
import type { SessionUser } from './auth.constants.js';
import type { AuthedRequest } from './auth.guard.js';

// httpOnly: page scripts cannot read it. sameSite lax: not sent on cross-site POSTs.
// Add `secure: true` once the app is served over HTTPS (guide, Step 6).
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() body: CredentialsDto): Promise<SessionUser> {
    return this.auth.register(body.username, body.password);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: CredentialsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const { user, token } = await this.auth.login(body.username, body.password);
    res.cookie(SESSION_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_MAX_AGE_MS,
    });
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
  }

  @Get('me')
  me(@Req() req: AuthedRequest): SessionUser {
    return req.user as SessionUser;
  }
}
