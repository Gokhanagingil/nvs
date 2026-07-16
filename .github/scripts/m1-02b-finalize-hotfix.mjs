import { readFile, writeFile } from 'node:fs/promises';

const path = '.github/scripts/m1-02b-finalize.mjs';
let source = await readFile(path, 'utf8');

source = source.replace(
`  source = replaceOnce(
    source,
    "        const verifiedResources = await Promise.all([",
    "        const choiceTransports = await this.verifyFixtureChoiceCompatibility(\\n          environment,\\n          fixture,\\n          sessions.tenantAdmin,\\n          'confirmed_readiness',\\n        );\\n        const verifiedResources = await Promise.all([",
    'confirmed choice validation call',
  );`,
`  source = replaceOnce(
    source,
    "        pass('actor-authentication', 'Required live actor profiles authenticated read-only.');\\n        const verifiedResources = await Promise.all([",
    "        pass('actor-authentication', 'Required live actor profiles authenticated read-only.');\\n        const choiceTransports = await this.verifyFixtureChoiceCompatibility(\\n          environment,\\n          fixture,\\n          sessions.tenantAdmin,\\n          'confirmed_readiness',\\n        );\\n        const verifiedResources = await Promise.all([",
    'confirmed choice validation call',
  );`,
);

source = source.replace(
`  source = replaceOnce(
    source,
    "      const verifiedResources = await Promise.all([",
    "      await this.verifyFixtureChoiceCompatibility(\\n        environment,\\n        fixture,\\n        sessions.tenantAdmin,\\n        \\`${input.runId}_fixture\\`,\\n      );\\n      const verifiedResources = await Promise.all([",
    'live choice validation call',
  );`,
`  source = replaceOnce(
    source,
    "      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);\\n      const verifiedResources = await Promise.all([",
    "      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);\\n      await this.verifyFixtureChoiceCompatibility(\\n        environment,\\n        fixture,\\n        sessions.tenantAdmin,\\n        \\`${input.runId}_fixture\\`,\\n      );\\n      const verifiedResources = await Promise.all([",
    'live choice validation call',
  );`,
);

source = source.replace(
`  source = replaceOnce(
    source,
    "                  ...transportObservation(summary.transport),\\n                  incidentId: incident.id,",
    "                  ...transportObservation(summary.transport),\\n                  ...operationsEvidence(polled.transports),\\n                  incidentId: incident.id,",
    'active/held SLA operations evidence',
  );`,
`  source = replaceOnce(
    source,
    "                const slaEvidence = {\\n                  ...transportObservation(summary.transport),\\n                  incidentId: incident.id,",
    "                const slaEvidence = {\\n                  ...transportObservation(summary.transport),\\n                  ...operationsEvidence(polled.transports),\\n                  incidentId: incident.id,",
    'active/held SLA operations evidence',
  );`,
);

if (!source.includes("pass('actor-authentication', 'Required live actor profiles authenticated read-only.');\\n        const choiceTransports")) {
  throw new Error('Confirmed-preflight anchor hotfix did not apply.');
}
if (!source.includes("sessions = await this.authenticateLiveActors(environment, fixture, input.runId);\\n      await this.verifyFixtureChoiceCompatibility")) {
  throw new Error('Live-run anchor hotfix did not apply.');
}

await writeFile(path, source, 'utf8');
