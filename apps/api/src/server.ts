import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const port = Number(process.env['NVS_API_PORT'] ?? '4100');
const host = process.env['NVS_API_HOST'] ?? '127.0.0.1';
const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
const app = buildApp({ rootDir });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
