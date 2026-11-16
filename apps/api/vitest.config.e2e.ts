import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    // Port 0 = any free port, so tests never clash with a running dev server on 4000.
    env: { PREVIEW_PORT: '0' },
  },
});
