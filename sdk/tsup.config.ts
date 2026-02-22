import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ai-sdk/index': 'src/ai-sdk/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  treeshake: true,
});
