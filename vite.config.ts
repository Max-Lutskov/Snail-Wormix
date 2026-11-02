import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build also works from a subpath or inside Capacitor.
  base: './',
  server: {
    // The room server (npm run server) behind the dev server, so one URL (or tunnel) serves both.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: {
    target: 'es2022',
    // Phaser alone is ~1.4 MB minified (~360 KB gzip); don't warn about it.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
