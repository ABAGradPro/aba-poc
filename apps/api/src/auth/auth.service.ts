import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionUser } from './auth.constants.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(username: string, password: string): Promise<SessionUser> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException('That username is already taken');
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      const user = await this.prisma.user.create({
        data: { username, passwordHash },
      });
      return { id: user.id, username: user.username };
    } catch (err: unknown) {
      // Two registrations for the same name at the same moment.
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('That username is already taken');
      }
      throw err;
    }
  }

  /** Returns a signed session token, or throws 401 with the same message for any failure. */
  async login(
    username: string,
    password: string,
  ): Promise<{ user: SessionUser; token: string }> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const ok = user ? await argon2.verify(user.passwordHash, password) : false;
    if (!user || !ok) {
      throw new UnauthorizedException('Wrong username or password');
    }
    const session: SessionUser = { id: user.id, username: user.username };
    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
    });
    return { user: session, token };
  }

  async verifyToken(token: string): Promise<SessionUser> {
    const payload = await this.jwt.verifyAsync<{
      sub: string;
      username: string;
    }>(token);
    return { id: payload.sub, username: payload.username };
  }
}
