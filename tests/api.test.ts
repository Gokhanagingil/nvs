import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../apps/api/src/app.js';
import {
  NilesAuthenticationAdapter,
  NilesReadOnlyAdapter,
  type FetchImplementation,
} from '@nvs/adapter-niles';
import { LiveRunBlockedError, NvsCore } from '@nvs/core';
import {
  EnvironmentVariableSecretProvider,
  credentialEnvironmentVariable,
} from '@nvs/secret-provider-environment';
import {
  FilesystemActorProfileRepository,
  FilesystemEnvironmentRepository,
  FilesystemRunBundleRepository,
  FilesystemScenarioRepository,
} from '@nvs/storage-filesystem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let app: ReturnType<typeof buildApp>;
let core: NvsCore;
let temporaryRoot: string;
const repositoryRoot = process.cwd();

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nvs-api-'));
  const webRoot = path.join(temporaryRoot, 'web');
  await mkdir(webRoot);
  await writeFile(
    path.join(webRoot, 'index.html'),
    '<!doctype html><html><body>NVS production console</body></html>',
    'utf8',
  );
  const fetchMock = vi
    .fn<FetchImplementation>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  core = new NvsCore(
    new FilesystemEnvironmentRepository(path.join(repositoryRoot, 'environments')),
    new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
    new FilesystemRunBundleRepository(temporaryRoot),
    new NilesReadOnlyAdapter(fetchMock),
    {
      profiles: new FilesystemActorProfileRepository(path.join(repositoryRoot, 'actors')),
      secrets: new EnvironmentVariableSecretProvider({}),
      authenticator: new NilesAuthenticationAdapter(fetchMock),
    },
  );
  app = buildApp({
    core,
    runtimePaths: {
      configDir: repositoryRoot,
      dataDir: temporaryRoot,
      webDir: webRoot,
    },
    idFactory: () => 'api-test-run',
    clock: () => '2026-07-14T12:00:00.000Z',
  });
});

afterEach(async () => {
  await app.close();
  await rm(temporaryRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('versioned control-plane API', () => {
  it('returns 202 Accepted for live API run launch without waiting for final execution', async () => {
    const startLiveApiRun = vi.fn().mockResolvedValue({
      schemaVersion: 'nvs.live-run-accepted/v1',
      runId: 'api-live-run',
      status: 'ACCEPTED',
    });
    const liveApp = buildApp({
      core: { startLiveApiRun } as unknown as NvsCore,
      runtimePaths: {
        configDir: repositoryRoot,
        dataDir: temporaryRoot,
        webDir: path.join(temporaryRoot, 'web'),
      },
      idFactory: () => 'api-live-run',
      clock: () => '2026-07-15T12:00:00.000Z',
    });
    try {
      const response = await liveApp.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          runType: 'LIVE_API',
          environmentId: 'live-test',
          scenarioId: 'payment-api-service-degradation',
          variationValues: { journey: 'normal' },
          confirmRealMutation: true,
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        schemaVersion: 'nvs.live-run-accepted/v1',
        runId: 'api-live-run',
        status: 'ACCEPTED',
      });
      expect(startLiveApiRun).toHaveBeenCalledWith({
        runId: 'api-live-run',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      });
    } finally {
      await liveApp.close();
    }
  });

  it('maps concurrent live API run launch to HTTP 409', async () => {
    const liveApp = buildApp({
      core: {
        startLiveApiRun: vi
          .fn()
          .mockRejectedValue(
            new LiveRunBlockedError('LIVE_RUN_IN_PROGRESS', 'Another run is active.'),
          ),
      } as unknown as NvsCore,
      runtimePaths: {
        configDir: repositoryRoot,
        dataDir: temporaryRoot,
        webDir: path.join(temporaryRoot, 'web'),
      },
      idFactory: () => 'api-live-run',
    });
    try {
      const response = await liveApp.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          runType: 'LIVE_API',
          environmentId: 'live-test',
          scenarioId: 'payment-api-service-degradation',
          variationValues: { journey: 'normal' },
          confirmRealMutation: true,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LIVE_RUN_IN_PROGRESS');
    } finally {
      await liveApp.close();
    }
  });

  it('serves the critical compile-only foundation endpoints', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/health/live' })).json()).toMatchObject({
      schemaVersion: 'nvs.liveness/v1',
      status: 'ok',
    });
    expect((await app.inject({ method: 'GET', url: '/api/health/ready' })).json()).toEqual({
      schemaVersion: 'nvs.readiness/v1',
      status: 'ready',
      checks: { configuration: 'ok', storage: 'ok' },
    });

    const environments = await app.inject({ method: 'GET', url: '/api/environments' });
    expect(environments.statusCode).toBe(200);
    expect(environments.json().items).toHaveLength(3);

    const probe = await app.inject({
      method: 'POST',
      url: '/api/environments/local-example/probe',
      payload: {},
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ verdict: 'PASS', health: { available: true } });

    const actors = await app.inject({
      method: 'GET',
      url: '/api/environments/local-example/actors',
    });
    expect(actors.statusCode).toBe(200);
    expect(actors.json().actors).toHaveLength(5);
    expect(
      actors
        .json()
        .actors.every(
          (actor: { credentialConfiguration: string }) =>
            actor.credentialConfiguration === 'NOT_CONFIGURED',
        ),
    ).toBe(true);
    expect(JSON.stringify(actors.json())).not.toMatch(/credentialRef|password|token|@/i);

    const authPreflight = await app.inject({
      method: 'POST',
      url: '/api/environments/local-example/auth-preflight',
      payload: {},
    });
    expect(authPreflight.statusCode).toBe(200);
    expect(authPreflight.json()).toMatchObject({
      schemaVersion: 'nvs.auth-preflight/v1',
      verdict: 'BLOCKED',
      gateEligible: false,
      assuranceScope: 'AUTHENTICATION_READINESS_ONLY',
    });
    expect(
      authPreflight
        .json()
        .actors.every(
          (actor: { error?: { code?: string } }) => actor.error?.code === 'CREDENTIAL_MISSING',
        ),
    ).toBe(true);
    expect(JSON.stringify(authPreflight.json())).not.toMatch(
      /password|accessToken|authorization|@/i,
    );

    const liveReadiness = await app.inject({
      method: 'GET',
      url: '/api/environments/local-example/execution-readiness?scenarioId=payment-api-service-degradation&journey=normal',
    });
    expect(liveReadiness.statusCode).toBe(200);
    expect(liveReadiness.json()).toMatchObject({
      schemaVersion: 'nvs.execution-readiness/v1',
      verdict: 'BLOCKED',
      confirmed: false,
      staticEligible: false,
      mutationEligible: false,
      gateEligible: false,
    });

    const confirmedLiveReadiness = await app.inject({
      method: 'POST',
      url: '/api/environments/local-example/execution-readiness/confirm',
      payload: {
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
      },
    });
    expect(confirmedLiveReadiness.statusCode).toBe(200);
    expect(confirmedLiveReadiness.json()).toMatchObject({
      schemaVersion: 'nvs.execution-readiness/v1',
      verdict: 'BLOCKED',
      confirmed: true,
      staticEligible: false,
      mutationEligible: false,
    });

    const blockedLiveRun = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        runType: 'LIVE_API',
        environmentId: 'local-example',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
      },
    });
    expect(blockedLiveRun.statusCode).toBe(403);
    expect(blockedLiveRun.json().error.code).toBe('LIVE_API_POLICY_DISABLED');

    const productionPreflight = await app.inject({
      method: 'POST',
      url: '/api/environments/production-example/auth-preflight',
      payload: {},
    });
    expect(productionPreflight.statusCode).toBe(403);
    expect(productionPreflight.json()).toEqual({
      error: {
        code: 'PRODUCTION_AUTH_PREFLIGHT_FORBIDDEN',
        category: 'ENVIRONMENT',
        message: 'Authentication preflight is forbidden for production environments.',
      },
    });

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

  it('serves build information and the SPA from the API port without masking API misses', async () => {
    vi.stubEnv('NVS_BUILD_SHA', '0123456789abcdef0123456789abcdef01234567');
    vi.stubEnv('NVS_BUILD_TIMESTAMP', '2026-07-14T17:00:00Z');
    vi.stubEnv('NVS_RELEASE_VERSION', '0.2.0-test');

    const version = await app.inject({ method: 'GET', url: '/api/version' });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toEqual({
      schemaVersion: 'nvs.version/v1',
      buildSha: '0123456789abcdef0123456789abcdef01234567',
      buildTimestamp: '2026-07-14T17:00:00Z',
      releaseVersion: '0.2.0-test',
      nodeVersion: process.version,
      contractVersion: 'nvs.operational/v1',
    });

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('NVS production console');

    const spaRoute = await app.inject({ method: 'GET', url: '/environments' });
    expect(spaRoute.statusCode).toBe(200);
    expect(spaRoute.body).toContain('NVS production console');

    const missingApi = await app.inject({ method: 'GET', url: '/api/not-real' });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json().error.code).toBe('NOT_FOUND');
  });

  it('blocks auth-preflight with PASSWORD_CHANGE_REQUIRED without leaking secrets', async () => {
    const webRoot = path.join(temporaryRoot, 'web-password-change');
    await mkdir(webRoot, { recursive: true });
    await writeFile(
      path.join(webRoot, 'index.html'),
      '<!doctype html><html><body>NVS production console</body></html>',
      'utf8',
    );
    const loginFetch = vi.fn<FetchImplementation>(
      async () =>
        new Response(
          JSON.stringify({
            accessToken: 'confidential-access-token',
            passwordChangeRequired: true,
            passwordPolicy: 'must rotate immediately',
            user: {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              tenantId: '11111111-1111-4111-8111-111111111111',
              email: 'requester@example.invalid',
              mustChangePassword: true,
            },
          }),
          { status: 200 },
        ),
    );
    const secretSource = Object.fromEntries(
      [
        'niles.local.requester',
        'niles.local.service-desk-agent',
        'niles.local.incident-manager',
        'niles.local.tenant-admin',
        'niles.local.cross-tenant-agent',
      ].map((reference, index) => [
        credentialEnvironmentVariable(reference),
        JSON.stringify({
          email: `actor${index}@example.invalid`,
          password: 'synthetic-test-value',
        }),
      ]),
    );
    const passwordChangeCore = new NvsCore(
      new FilesystemEnvironmentRepository(path.join(repositoryRoot, 'environments')),
      new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
      new FilesystemRunBundleRepository(temporaryRoot),
      new NilesReadOnlyAdapter(vi.fn<FetchImplementation>()),
      {
        profiles: new FilesystemActorProfileRepository(path.join(repositoryRoot, 'actors')),
        secrets: new EnvironmentVariableSecretProvider(secretSource),
        authenticator: new NilesAuthenticationAdapter(loginFetch),
      },
    );
    const passwordChangeApp = buildApp({
      core: passwordChangeCore,
      runtimePaths: {
        configDir: repositoryRoot,
        dataDir: temporaryRoot,
        webDir: webRoot,
      },
      logger: false,
    });
    try {
      const response = await passwordChangeApp.inject({
        method: 'POST',
        url: '/api/environments/local-example/auth-preflight',
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: 'nvs.auth-preflight/v1',
        verdict: 'BLOCKED',
        gateEligible: false,
      });
      expect(
        response
          .json()
          .actors.every(
            (actor: { authenticationState: string; error?: { code?: string } }) =>
              actor.authenticationState === 'BLOCKED' &&
              actor.error?.code === 'PASSWORD_CHANGE_REQUIRED',
          ),
      ).toBe(true);
      expect(JSON.stringify(response.json())).not.toMatch(
        /confidential-access-token|@example|synthetic-test-value|must rotate|passwordPolicy|mustChangePassword/i,
      );
    } finally {
      await passwordChangeApp.close();
    }
  });

  it('returns typed 503 BLOCKED readiness for unusable configuration', async () => {
    const emptyConfig = path.join(temporaryRoot, 'empty-config');
    await Promise.all(
      ['actors', 'environments', 'scenarios'].map((directory) =>
        mkdir(path.join(emptyConfig, directory), { recursive: true }),
      ),
    );
    const blockedApp = buildApp({
      core,
      runtimePaths: {
        configDir: emptyConfig,
        dataDir: temporaryRoot,
        webDir: path.join(temporaryRoot, 'web'),
      },
      logger: false,
    });
    try {
      const response = await blockedApp.inject({ method: 'GET', url: '/api/health/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        schemaVersion: 'nvs.readiness/v1',
        status: 'blocked',
        checks: { configuration: 'blocked', storage: 'ok' },
        error: {
          category: 'ENVIRONMENT',
          code: 'LOCAL_CONFIGURATION_INVALID',
          retryable: false,
        },
      });
    } finally {
      await blockedApp.close();
    }
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
