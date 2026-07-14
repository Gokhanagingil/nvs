import {
  businessBlueprintV1Schema,
  environmentDefinitionV1Schema,
  parseBusinessBlueprint,
  parseEnvironmentDefinition,
  runRecordV1Schema,
  type BusinessBlueprintV1,
} from '@nvs/contracts';
import {
  FilesystemEnvironmentRepository,
  FilesystemScenarioRepository,
} from '@nvs/storage-filesystem';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function validCompileOnlyRun(): Record<string, unknown> {
  const runId = 'contract-test-run';
  return {
    schemaVersion: 'nvs.run/v1',
    runId,
    runType: 'COMPILE_ONLY',
    status: 'COMPLETED',
    verdict: 'PASS',
    gateEligible: false,
    assuranceScope: 'COMPILATION_ONLY',
    environmentId: 'local-example',
    scenario: { id: 'scenario', version: '1.0.0' },
    variationValues: {},
    planId: 'plan-id',
    toolVersions: { nvs: '0.1.0', node: 'v24.18.0', contracts: 'v1' },
    timestamps: {
      createdAt: '2026-07-14T12:00:00.000Z',
      completedAt: '2026-07-14T12:00:00.000Z',
    },
    stepResults: [
      {
        stepId: 'step-id',
        compilationStatus: 'PASS',
        executionStatus: 'NOT_EXECUTED',
      },
    ],
    evidence: [
      {
        id: 'run-record',
        kind: 'RUN',
        path: `runs/${runId}/run.json`,
        mediaType: 'application/json',
      },
      {
        id: 'compiled-plan',
        kind: 'PLAN',
        path: `runs/${runId}/plan.json`,
        mediaType: 'application/json',
      },
      {
        id: 'evidence-manifest',
        kind: 'MANIFEST',
        path: `runs/${runId}/evidence.json`,
        mediaType: 'application/json',
      },
    ],
    sanitization: { applied: true, redactedFields: [], patterns: [] },
    cleanup: { status: 'NOT_REQUIRED' },
  };
}

describe('versioned contracts', () => {
  it('loads the committed environment and business blueprint examples', async () => {
    const environments = await new FilesystemEnvironmentRepository(`${root}/environments`).list();
    const scenarios = await new FilesystemScenarioRepository(`${root}/scenarios`).list();

    expect(environments.map((environment) => environment.id)).toEqual([
      'local-example',
      'staging-example',
    ]);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.reviewState).toBe('approved');
  });

  it.each([
    ['unsupported schema', { schemaVersion: 'nvs.environment/v2' }],
    ['unsafe ID', { id: '../production' }],
    ['malformed URL', { baseUrl: 'not-a-url' }],
    ['URL credentials', { baseUrl: 'https://admin:password@example.invalid' }],
    ['unknown field', { unexpected: true }],
  ])('rejects an invalid environment: %s', async (_name, replacement) => {
    const valid = (await new FilesystemEnvironmentRepository(`${root}/environments`).get(
      'local-example',
    ))!;
    expect(environmentDefinitionV1Schema.safeParse({ ...valid, ...replacement }).success).toBe(
      false,
    );
  });

  it.each([
    'accessToken',
    'refresh_token',
    'clientSecret',
    'privateKey',
    'credential',
    'passwordValue',
    'sessionCookie',
    'authorization',
    'apiKey',
    'api-key',
    'api_key',
  ])('rejects the secret-bearing environment field %s', async (fieldName) => {
    const valid = (await new FilesystemEnvironmentRepository(`${root}/environments`).get(
      'local-example',
    ))!;
    expect(() =>
      parseEnvironmentDefinition({ ...valid, [fieldName]: 'should-not-be-versioned' }),
    ).toThrow(/secret-bearing field/i);
  });

  it('rejects malformed blueprint fields and references', async () => {
    const valid = (await new FilesystemScenarioRepository(`${root}/scenarios`).get(
      'payment-api-service-degradation',
    ))!;
    const unknownField = { ...valid, transportEndpoint: '/api/incidents' };
    expect(() => parseBusinessBlueprint(unknownField)).toThrow();

    const invalidActor = structuredClone(valid) as BusinessBlueprintV1;
    invalidActor.steps[0]!.actor = 'undeclared-actor';
    expect(() => businessBlueprintV1Schema.parse(invalidActor)).toThrow();
  });

  it('rejects nested secret fields in variation input overrides', async () => {
    const valid = (await new FilesystemScenarioRepository(`${root}/scenarios`).get(
      'payment-api-service-degradation',
    ))!;
    const invalid = structuredClone(valid);
    invalid.variationDimensions[0]!.values[0]!.overrides.inputOverrides = {
      'report-degradation': { accessToken: 'should-not-be-versioned' },
    };

    expect(() => parseBusinessBlueprint(invalid)).toThrow(/secret-bearing field "accessToken"/i);
  });

  it('validates symbolic references inside variation input overrides', async () => {
    const valid = (await new FilesystemScenarioRepository(`${root}/scenarios`).get(
      'payment-api-service-degradation',
    ))!;
    const invalid = structuredClone(valid);
    invalid.variationDimensions[0]!.values[0]!.overrides.inputOverrides = {
      'report-degradation': { tenant: '${unknown-tenant}' },
    };
    expect(() => parseBusinessBlueprint(invalid)).toThrow(
      /unknown symbolic reference: unknown-tenant/i,
    );

    const accepted = structuredClone(valid);
    accepted.variationDimensions[0]!.values[0]!.overrides.inputOverrides = {
      'report-degradation': { tenant: '${tenant}' },
    };
    expect(parseBusinessBlueprint(accepted)).toBeDefined();
  });

  it('enforces compile-only assurance and execution invariants', () => {
    expect(runRecordV1Schema.safeParse(validCompileOnlyRun()).success).toBe(true);

    const gateEligible = { ...validCompileOnlyRun(), gateEligible: true };
    expect(runRecordV1Schema.safeParse(gateEligible).success).toBe(false);

    const assuranceScope = { ...validCompileOnlyRun(), assuranceScope: 'RUNTIME' };
    expect(runRecordV1Schema.safeParse(assuranceScope).success).toBe(false);

    const executed = validCompileOnlyRun();
    executed['stepResults'] = [
      { stepId: 'step-id', compilationStatus: 'PASS', executionStatus: 'EXECUTED' },
    ];
    expect(runRecordV1Schema.safeParse(executed).success).toBe(false);
  });

  it.each(['FAIL', 'BLOCKED'])(
    'rejects a PASS run containing a %s compilation step',
    (compilationStatus) => {
      const run = validCompileOnlyRun();
      run['stepResults'] = [
        {
          stepId: 'step-id',
          compilationStatus,
          executionStatus: 'NOT_EXECUTED',
          error: {
            category: 'SCENARIO_CONTRACT',
            code: 'COMPILATION_STEP_REJECTED',
            message: 'The step did not compile.',
            retryable: false,
          },
        },
      ];
      expect(runRecordV1Schema.safeParse(run).success).toBe(false);
    },
  );

  it('rejects errors on a PASS run or passed compilation step', () => {
    const runError = {
      ...validCompileOnlyRun(),
      error: {
        category: 'SCENARIO_CONTRACT',
        code: 'UNEXPECTED_ERROR',
        message: 'An error is inconsistent with PASS.',
        retryable: false,
      },
    };
    expect(runRecordV1Schema.safeParse(runError).success).toBe(false);

    const stepError = validCompileOnlyRun();
    stepError['stepResults'] = [
      {
        stepId: 'step-id',
        compilationStatus: 'PASS',
        executionStatus: 'NOT_EXECUTED',
        error: {
          category: 'SCENARIO_CONTRACT',
          code: 'UNEXPECTED_ERROR',
          message: 'An error is inconsistent with PASS.',
          retryable: false,
        },
      },
    ];
    expect(runRecordV1Schema.safeParse(stepError).success).toBe(false);
  });
});
