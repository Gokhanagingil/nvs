import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../apps/api/src/app.js';
import { NilesReadOnlyAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import { NvsCore } from '@nvs/core';
import {
  FilesystemEnvironmentRepository,
  FilesystemRunBundleRepository,
  FilesystemScenarioRepository,
} from '@nvs/storage-filesystem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let app: ReturnType<typeof buildApp>;
let temporaryRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nvs-api-'));
  const repositoryRoot = process.cwd();
  const fetchMock = vi
    .fn<FetchImplementation>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const core = new NvsCore(
    new FilesystemEnvironmentRepository(path.join(repositoryRoot, 'environments')),
    new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
    new FilesystemRunBundleRepository(temporaryRoot),
    new NilesReadOnlyAdapter(fetchMock),
  );
  app = buildApp({
    core,
    idFactory: () => 'api-test-run',
    clock: () => '2026-07-14T12:00:00.000Z',
  });
});

afterEach(async () => {
  await app.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('versioned control-plane API', () => {
  it('serves the critical compile-only foundation endpoints', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);

    const environments = await app.inject({ method: 'GET', url: '/api/environments' });
    expect(environments.statusCode).toBe(200);
    expect(environments.json().items).toHaveLength(2);

    const probe = await app.inject({
      method: 'POST',
      url: '/api/environments/local-example/probe',
      payload: {},
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ verdict: 'PASS', health: { available: true } });

    const scenarios = await app.inject({ method: 'GET', url: '/api/scenarios' });
    expect(scenarios.statusCode).toBe(200);
    expect(scenarios.json().items[0].narrative).toContain('customer-facing payment/API service');

    const scenario = await app.inject({
      method: 'GET',
      url: '/api/scenarios/payment-api-service-degradation',
    });
    expect(scenario.statusCode).toBe(200);
    expect(scenario.json().reviewState).toBe('approved');

    const compilation = await app.inject({
      method: 'POST',
      url: '/api/scenarios/payment-api-service-degradation/compile',
      payload: { variationValues: { journey: 'close-before-resolve' } },
    });
    expect(compilation.statusCode).toBe(200);
    expect(compilation.json()).toMatchObject({
      schemaVersion: 'nvs.plan/v1',
      expectedOutcome: 'INVALID_TRANSITION',
    });

    const creation = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        runType: 'COMPILE_ONLY',
        environmentId: 'local-example',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
      },
    });
    expect(creation.statusCode).toBe(201);
    const creationBody = creation.json();
    expect(creationBody).toMatchObject({
      runId: 'api-test-run',
      verdict: 'PASS',
      gateEligible: false,
      assuranceScope: 'COMPILATION_ONLY',
    });
    expect(
      creationBody.stepResults.every(
        (step: { compilationStatus: string; executionStatus: string }) =>
          step.compilationStatus === 'PASS' && step.executionStatus === 'NOT_EXECUTED',
      ),
    ).toBe(true);

    const runs = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(runs.json().items).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/runs/api-test-run' })).statusCode).toBe(
      200,
    );

    const plan = await app.inject({
      method: 'GET',
      url: '/api/runs/api-test-run/plan',
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({
      schemaVersion: 'nvs.plan/v1',
      scenario: { id: 'payment-api-service-degradation' },
    });
    expect(plan.json().steps[0].source.blueprintStepId).toBe('report-degradation');

    const evidence = await app.inject({
      method: 'GET',
      url: '/api/runs/api-test-run/evidence',
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().entries).toHaveLength(3);
    expect(evidence.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'RUN', path: 'runs/api-test-run/run.json' }),
        expect.objectContaining({ kind: 'PLAN', path: 'runs/api-test-run/plan.json' }),
      ]),
    );

    const coverage = await app.inject({ method: 'GET', url: '/api/coverage' });
    expect(coverage.statusCode).toBe(200);
    expect(coverage.json().summary).toEqual({ cells: 8, executed: 0 });
  });

  it('rejects unknown fields with a safe consistent error envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scenarios/payment-api-service-degradation/compile',
      payload: { variationValues: {}, absolutePath: 'C:\\private\\scenario.yaml' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        category: 'SCENARIO_CONTRACT',
        message: 'Request validation failed.',
      },
    });
    expect(JSON.stringify(body)).not.toContain('C:\\private');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack');
  });

  it('maps a duplicate run ID to a typed HTTP 409 conflict', async () => {
    const payload = {
      runType: 'COMPILE_ONLY',
      runId: 'duplicate-api-run',
      environmentId: 'local-example',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
    };
    expect((await app.inject({ method: 'POST', url: '/api/runs', payload })).statusCode).toBe(201);

    const duplicate = await app.inject({ method: 'POST', url: '/api/runs', payload });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: {
        code: 'RUN_ID_ALREADY_EXISTS',
        category: 'PERSISTENCE',
        message: 'A run with this identifier already exists.',
      },
    });

    const runs = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(runs.json().items).toHaveLength(1);
  });
});
