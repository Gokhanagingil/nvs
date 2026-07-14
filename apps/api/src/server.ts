import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const port = Number(process.env['NVS_API_PORT'] ?? '4100');
const host = process.env['NVS_API_HOST'] ?? '127.0.0.1';
const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
const app = buildApp({ rootDir, logger: process.env['NVS_LOG_LEVEL'] !== 'silent' });
let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  app.log.info({ signal }, 'NVS shutdown requested');
  try {
    await app.close();
  } catch (error) {
    app.log.error({ error }, 'NVS shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close().catch(() => undefined);
}
