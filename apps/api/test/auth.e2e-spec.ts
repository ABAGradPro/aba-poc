import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Needs the local PostgreSQL from infra/compose.yml: pnpm --filter api test:e2e
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const username = `e2e-${Date.now()}`;
  const password = 'a long password';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('health is public', async () => {
    await http().get('/api/health').expect(200, { status: 'ok' });
  });

  it('protected routes need a login', async () => {
    await http().get('/api/auth/me').expect(401);
  });

  it('rejects bad input', async () => {
    await http()
      .post('/api/auth/register')
      .send({ username: 'X', password: 'short' })
      .expect(400);
  });

  it('register, log out, log in again; wrong password is 401', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ username, password })
      .expect(201);
    expect(reg.body).toMatchObject({ username });
    expect(reg.body).not.toHaveProperty('passwordHash');

    await http()
      .post('/api/auth/register')
      .send({ username, password })
      .expect(409);

    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toContain('aba_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    await agent.get('/api/auth/me').expect(200).expect((r) => {
      expect(r.body.username).toBe(username);
    });

    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);

    await agent.post('/api/auth/login').send({ username, password }).expect(200);
    await agent.get('/api/auth/me').expect(200);

    await http()
      .post('/api/auth/login')
      .send({ username, password: 'wrong password' })
      .expect(401);
  });

  it('stores an Argon2id hash in the database', async () => {
    const row = await prisma.user.findUnique({ where: { username } });
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('the sixth login attempt within a minute gets 429', async () => {
    // Fresh app so earlier logins in this file do not count.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const fresh = moduleRef.createNestApplication();
    configureApp(fresh);
    await fresh.init();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await request(fresh.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: 'wrong password' });
      codes.push(r.status);
    }
    await fresh.close();
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });
});
