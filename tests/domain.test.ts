import type { EnvironmentDefinitionV1, ErrorCategory } from '@nvs/contracts';
import {
  DomainPolicyError,
  classifyError,
  compileBlueprint,
  enforceEnvironmentOperationPolicy,
  sanitizeForPersistence,
  stableJson,
  typedError,
} from '@nvs/domain';
import { FilesystemScenarioRepository } from '@nvs/storage-filesystem';
import { beforeAll, describe, expect, it } from 'vitest';

let scenario: Awaited<ReturnType<FilesystemScenarioRepository['get']>>;

beforeAll(async () => {
  scenario = await new FilesystemScenarioRepository(`${process.cwd()}/scenarios`).get(
    'payment-api-service-degradation',
  );
});

describe('domain compiler and policy', () => {
  it('prevents mutating runs against production', () => {
    const production: EnvironmentDefinitionV1 = {
      schemaVersion: 'nvs.environment/v1',
      id: 'production',
      displayName: 'Production',
      baseUrl: 'https://production.invalid',
      kind: 'production',
      healthPath: '/health/live',
      capabilities: { health: true, readiness: false, openApi: false, version: false },
      enabled: true,
    };

    expect(() => enforceEnvironmentOperationPolicy(production, 'MUTATING')).toThrow(
      DomainPolicyError,
    );
    expect(() => enforceEnvironmentOperationPolicy(production, 'COMPILE_ONLY')).not.toThrow();
    expect(() => enforceEnvironmentOperationPolicy(production, 'READ_ONLY')).not.toThrow();
  });

  it('produces equivalent plans for the same input', () => {
    const first = compileBlueprint(scenario!, { journey: 'normal' });
    const second = compileBlueprint(structuredClone(scenario!), { journey: 'normal' });

    expect(stableJson(first)).toBe(stableJson(second));
    expect(first.id).toBe(second.id);
    expect(first.steps.every((step) => step.source.blueprintStepId.length > 0)).toBe(true);
    expect(
      first.steps.some((step) =>
        Object.values(step.inputs).some((input) => input.kind === 'SYMBOLIC'),
      ),
    ).toBe(true);
  });

  it('compiles every declared variation value', () => {
    const dimension = scenario!.variationDimensions[0]!;
    const plans = dimension.values.map((value) =>
      compileBlueprint(scenario!, { [dimension.id]: value.id }),
    );

    expect(plans).toHaveLength(8);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(8);
    expect(plans.map((plan) => plan.expectedOutcome)).toEqual([
      'SUCCESS',
      'MISSING_EVIDENCE',
      'INVALID_TRANSITION',
      'ACCESS_DENIED',
      'ACCESS_DENIED',
      'ACCESS_DENIED',
      'SLA_VALIDATION',
      'SLA_VALIDATION',
    ]);
  });

  it.each([
    ['PRODUCT', 'FAIL'],
    ['ASSERTION', 'FAIL'],
    ['ADAPTER', 'BLOCKED'],
    ['ENVIRONMENT', 'BLOCKED'],
    ['SCENARIO_CONTRACT', 'BLOCKED'],
    ['PERSISTENCE', 'BLOCKED'],
    ['CLEANUP', 'BLOCKED'],
    ['CANCELLATION', 'BLOCKED'],
  ] satisfies [ErrorCategory, 'FAIL' | 'BLOCKED'][])(
    'classifies %s errors as %s',
    (category, verdict) => {
      expect(classifyError(typedError(category, 'TEST_ERROR', 'Deterministic test error.'))).toBe(
        verdict,
      );
    },
  );

  it('classifies an error-free result as PASS', () => {
    expect(classifyError(undefined)).toBe('PASS');
  });

  it('redacts sensitive fields and credential patterns before persistence', () => {
    const sanitized = sanitizeForPersistence({
      authorization: 'Bearer top-secret-token',
      diagnostic: 'Authorization: Bearer abc.def.ghi',
      target: 'https://operator:credential@niles.invalid/health',
    });

    expect(JSON.stringify(sanitized)).not.toContain('top-secret-token');
    expect(JSON.stringify(sanitized)).not.toContain('abc.def.ghi');
    expect(JSON.stringify(sanitized)).not.toContain('operator:credential');
    expect(sanitized).toMatchObject({
      authorization: '[REDACTED]',
      diagnostic: 'Authorization: Bearer [REDACTED]',
      target: 'https://[REDACTED]@niles.invalid/health',
    });
  });
});
