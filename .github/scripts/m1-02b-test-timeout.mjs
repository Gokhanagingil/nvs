import { readFile, writeFile } from 'node:fs/promises';

const path = 'tests/live-incident.test.ts';
let source = await readFile(path, 'utf8');

const from = `      correlationIdFactory: (seed) => \`live_\${seed.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}\`,
      ...(backgroundCoordinator ? { backgroundCoordinator } : {}),`;
const to = `      correlationIdFactory: (seed) => \`live_\${seed.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}\`,
      slaObservationTimeoutMs: 25,
      slaObservationIntervalMs: 1,
      sleep: async (milliseconds) => {
        if (milliseconds > 0) await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
      },
      ...(backgroundCoordinator ? { backgroundCoordinator } : {}),`;

if (!source.includes(from)) {
  throw new Error('buildCore live dependency target was not found');
}
source = source.replace(from, to);
await writeFile(path, source, 'utf8');
