import path from 'node:path';
import { createCore } from './app.js';
import { checkLocalReadiness, resolveRuntimePaths } from './operations.js';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const rootDir = process.cwd();
const command = process.argv[2] ?? 'compile-run';

try {
  if (command === 'ready-check') {
    const readiness = await checkLocalReadiness(resolveRuntimePaths(rootDir));
    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
    if (readiness.status !== 'ready') {
      process.exitCode = 2;
    }
  } else if (command === 'probe') {
    const core = createCore(rootDir);
    const result = await core.probeEnvironment(option('environment', 'local-example'));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.verdict === 'BLOCKED') {
      process.exitCode = 2;
    }
  } else if (command === 'compile-run') {
    const core = createCore(rootDir);
    const run = await core.createCompileOnlyRun({
      runId: option('run-id', 'example-compile-only'),
      environmentId: option('environment', 'local-example'),
      scenarioId: option('scenario', 'payment-api-service-degradation'),
      variationValues: { journey: option('variation', 'normal') },
      now: option('now', '2026-07-14T12:00:00.000Z'),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          runId: run.runId,
          verdict: run.verdict,
          assuranceScope: run.assuranceScope,
          gateEligible: run.gateEligible,
          planId: run.planId,
          artifactPath: path.posix.join('artifacts', 'runs', run.runId, 'run.json'),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    throw new Error('Unsupported CLI command.');
  }
} catch (error) {
  const duplicateRunId =
    error instanceof Error && 'code' in error && error.code === 'RUN_ID_ALREADY_EXISTS';
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: duplicateRunId ? 'RUN_ID_ALREADY_EXISTS' : 'CLI_COMMAND_FAILED',
        message: duplicateRunId
          ? 'A run with this identifier already exists.'
          : 'The requested NVS command could not be completed.',
      },
    })}\n`,
  );
  process.exitCode = 1;
}
