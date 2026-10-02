import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2022',
    clean: true,
    sourcemap: false,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'es2022',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
    sourcemap: false,
  },
]);
