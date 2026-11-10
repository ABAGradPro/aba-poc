import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // Only reachable from this laptop; the React dev server proxies /api here.
  await app.listen(process.env.PORT ?? 3000, '127.0.0.1');
}
await bootstrap();
