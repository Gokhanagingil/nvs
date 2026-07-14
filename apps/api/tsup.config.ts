import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  shims: true,
  outDir: 'dist',
  external: ['yaml'],
  noExternal: [/^@nvs\//],
});
