import { readFile, writeFile } from 'node:fs/promises';

const path = '.github/scripts/m1-02b-finalize.mjs';
let source = await readFile(path, 'utf8');

function replaceExact(fromLines, toLines, label) {
  const from = fromLines.join('\n');
  const to = toLines.join('\n');
  if (!source.includes(from)) {
    throw new Error(`Missing hotfix target: ${label}`);
  }
  source = source.replace(from, to);
}

replaceExact(
  [
    '  source = replaceOnce(',
    '    source,',
    '    "      const verifiedResources = await Promise.all([",',
    '    "      await this.verifyFixtureChoiceCompatibility(\\n        environment,\\n        fixture,\\n        sessions.tenantAdmin,\\n        `${input.runId}_fixture`,\\n      );\\n      const verifiedResources = await Promise.all([",',
    "    'live choice validation call',",
    '  );',
  ],
  [
    '  source = replaceOnce(',
    '    source,',
    '    "      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);\\n      const verifiedResources = await Promise.all([",',
    '    "      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);\\n      await this.verifyFixtureChoiceCompatibility(\\n        environment,\\n        fixture,\\n        sessions.tenantAdmin,\\n        `${input.runId}_fixture`,\\n      );\\n      const verifiedResources = await Promise.all([",',
    "    'live choice validation call',",
    '  );',
  ],
  'live choice validation call',
);

replaceExact(
  [
    '  source = replaceOnce(',
    '    source,',
    '    "                  ...transportObservation(summary.transport),\\n                  incidentId: incident.id,",',
    '    "                  ...transportObservation(summary.transport),\\n                  ...operationsEvidence(polled.transports),\\n                  incidentId: incident.id,",',
    "    'active/held SLA operations evidence',",
    '  );',
  ],
  [
    '  source = replaceOnce(',
    '    source,',
    '    "                const slaEvidence = {\\n                  ...transportObservation(summary.transport),\\n                  incidentId: incident.id,",',
    '    "                const slaEvidence = {\\n                  ...transportObservation(summary.transport),\\n                  ...operationsEvidence(polled.transports),\\n                  incidentId: incident.id,",',
    "    'active/held SLA operations evidence',",
    '  );',
  ],
  'active/held SLA evidence',
);

source = source.replace(
  "await edit('config/fixtures/niles-incident.staging.example.yaml'",
  "await edit('fixtures/niles-incident/staging.example.yaml'",
);

await writeFile(path, source, 'utf8');
