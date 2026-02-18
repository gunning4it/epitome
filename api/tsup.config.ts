import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  // Let tsup externalize node_modules by default
  // This avoids CJS/ESM compat issues with native modules like argon2
});
