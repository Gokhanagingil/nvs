import {
  businessBlueprintV1Schema,
  environmentDefinitionV1Schema,
  parseBusinessBlueprint,
  parseEnvironmentDefinition,
  type BusinessBlueprintV1,
} from '@nvs/contracts';
import {
  FilesystemEnvironmentRepository,
  FilesystemScenarioRepository,
} from '@nvs/storage-filesystem';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

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

  it('rejects obvious secret-bearing versioned fields', async () => {
    const valid = (await new FilesystemEnvironmentRepository(`${root}/environments`).get(
      'local-example',
    ))!;
    expect(() =>
      parseEnvironmentDefinition({ ...valid, token: 'should-not-be-versioned' }),
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
});
