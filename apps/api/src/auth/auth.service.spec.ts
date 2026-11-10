import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type StoredUser = { id: string; username: string; passwordHash: string };

/** A tiny in-memory stand-in for the User table. */
function fakePrisma() {
  const users = new Map<string, StoredUser>();
  return {
    users,
    user: {
      findUnique: vi.fn(({ where }: { where: { username: string } }) =>
        Promise.resolve(users.get(where.username) ?? null),
      ),
      create: vi.fn(
        ({ data }: { data: { username: string; passwordHash: string } }) => {
          const u = { id: `id-${users.size + 1}`, ...data };
          users.set(u.username, u);
          return Promise.resolve(u);
        },
      ),
    },
  };
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: AuthService;
  const jwt = new JwtService({ secret: 'test-secret-that-is-long-enough-1234' });

  beforeEach(() => {
    prisma = fakePrisma();
    service = new AuthService(prisma as unknown as PrismaService, jwt);
  });

  it('stores only an Argon2id hash of the password', async () => {
    await service.register('alice', 'correct horse');
    const stored = prisma.users.get('alice')!;
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.passwordHash).not.toContain('correct horse');
    expect(await argon2.verify(stored.passwordHash, 'correct horse')).toBe(true);
  });

  it('answers 409 for a taken username', async () => {
    await service.register('alice', 'correct horse');
    await expect(service.register('alice', 'another pass')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('logs in with the right password and returns a verifiable token', async () => {
    await service.register('alice', 'correct horse');
    const { user, token } = await service.login('alice', 'correct horse');
    expect(user.username).toBe('alice');
    expect(await service.verifyToken(token)).toEqual(user);
  });

  it('answers 401 for a wrong password or an unknown user, with the same message', async () => {
    await service.register('alice', 'correct horse');
    await expect(service.login('alice', 'wrong password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.login('nobody', 'whatever123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.login('alice', 'wrong password')).rejects.toThrow(
      'Wrong username or password',
    );
    await expect(service.login('nobody', 'whatever123')).rejects.toThrow(
      'Wrong username or password',
    );
  });

  it('rejects a tampered token', async () => {
    await service.register('alice', 'correct horse');
    const { token } = await service.login('alice', 'correct horse');
    await expect(service.verifyToken(token.slice(0, -2) + 'xx')).rejects.toThrow();
  });
});
