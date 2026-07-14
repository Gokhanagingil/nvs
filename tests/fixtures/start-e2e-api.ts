import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const configRoot = path.join(repositoryRoot, 'artifacts', 'e2e-config');
const mockNilesPort = process.env['NVS_MOCK_NILES_PORT'] ?? '4310';

rmSync(configRoot, { recursive: true, force: true });
for (const directory of ['actors', 'environments', 'scenarios']) {
  cpSync(path.join(repositoryRoot, directory), path.join(configRoot, directory), {
    recursive: true,
  });
}

const localEnvironmentPath = path.join(configRoot, 'environments', 'local.example.yaml');
const localEnvironment = readFileSync(localEnvironmentPath, 'utf8');
const isolatedEnvironment = localEnvironment.replace(
  /^baseUrl: .*$/m,
  `baseUrl: http://127.0.0.1:${mockNilesPort}`,
);
if (isolatedEnvironment === localEnvironment) {
  throw new Error('The local e2e environment base URL could not be isolated.');
}
writeFileSync(localEnvironmentPath, isolatedEnvironment, 'utf8');

process.env['NVS_CONFIG_DIR'] = configRoot;
await import('../../apps/api/src/server.js');
