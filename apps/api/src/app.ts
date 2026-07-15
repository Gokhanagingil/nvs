import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  NilesIncidentApiAdapter,
  NilesAuthenticationAdapter,
  NilesReadOnlyAdapter,
  type FetchImplementation,
} from '@nvs/adapter-niles';
import { safeIdSchema } from '@nvs/contracts';
import { AuthenticationBlockedError, LiveRunBlockedError, NvsCore } from '@nvs/core';
import { DomainPolicyError } from '@nvs/domain';
import { EnvironmentVariableSecretProvider } from '@nvs/secret-provider-environment';
import {
  FilesystemActorProfileRepository,
  FilesystemEnvironmentRepository,
  FilesystemLiveRunStateRepository,
  FilesystemNilesIncidentFixtureRepository,
  FilesystemRunBundleRepository,
  FilesystemScenarioRepository,
  RunIdAlreadyExistsError,
  StorageCorruptionError,
  UnsafeIdentifierError,
} from '@nvs/storage-filesystem';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  buildInformation,
  checkLocalReadiness,
  resolveRuntimePaths,
  type RuntimePaths,
} from './operations.js';

const idParamsSchema = z.object({ id: safeIdSchema }).strict();
const compileBodySchema = z
  .object({
    variationValues: z.record(safeIdSchema, safeIdSchema).default({}),
  })
  .strict();
const createRunBodySchema = z.discriminatedUnion('runType', [
  z
    .object({
      runType: z.literal('COMPILE_ONLY'),
      runId: safeIdSchema.optional(),
      environmentId: safeIdSchema,
      scenarioId: safeIdSchema,
      variationValues: z.record(safeIdSchema, safeIdSchema).default({}),
    })
    .strict(),
  z
    .object({
      runType: z.literal('LIVE_API'),
      runId: safeIdSchema.optional(),
      environmentId: safeIdSchema,
      scenarioId: safeIdSchema,
      variationValues: z.record(safeIdSchema, safeIdSchema).default({}),
      confirmRealMutation: z.literal(true),
    })
    .strict(),
]);
const emptyBodySchema = z.object({}).strict();

export interface BuildAppOptions {
  rootDir?: string;
  runtimePaths?: RuntimePaths;
  core?: NvsCore;
  fetchImplementation?: FetchImplementation;
  idFactory?: () => string;
  clock?: () => string;
  logger?: boolean;
}

let runSequence = 0;
function defaultRunId(): string {
  runSequence += 1;
  return `run_${Date.now().toString(36)}_${runSequence.toString(36)}`;
}

export function createCore(rootDir: string, fetchImplementation?: FetchImplementation): NvsCore {
  const runtimePaths = resolveRuntimePaths(rootDir);
  const configuredAuthenticationTimeout = Number(
    process.env['NVS_AUTHENTICATION_TIMEOUT_MS'] ?? '5000',
  );
  const authenticationTimeout =
    Number.isInteger(configuredAuthenticationTimeout) &&
    configuredAuthenticationTimeout >= 1 &&
    configuredAuthenticationTimeout <= 30_000
      ? configuredAuthenticationTimeout
      : 5_000;
  return new NvsCore(
    new FilesystemEnvironmentRepository(path.join(runtimePaths.configDir, 'environments')),
    new FilesystemScenarioRepository(path.join(runtimePaths.configDir, 'scenarios')),
    new FilesystemRunBundleRepository(runtimePaths.dataDir),
    new NilesReadOnlyAdapter(fetchImplementation),
    {
      profiles: new FilesystemActorProfileRepository(path.join(runtimePaths.configDir, 'actors')),
      secrets: new EnvironmentVariableSecretProvider(),
      authenticator: new NilesAuthenticationAdapter(fetchImplementation, authenticationTimeout),
    },
    {
      fixtures: new FilesystemNilesIncidentFixtureRepository(
        path.join(runtimePaths.configDir, 'fixtures', 'niles-incident'),
      ),
      incidentAdapter: new NilesIncidentApiAdapter(fetchImplementation, authenticationTimeout),
      state: new FilesystemLiveRunStateRepository(runtimePaths.dataDir),
      mutationsEnabled: () => process.env['NVS_ENABLE_NILES_MUTATIONS'] === 'true',
    },
  );
}

function safeError(error: unknown): {
  statusCode: number;
  body: { error: { code: string; category: string; message: string } };
} {
  if (error instanceof ZodError || error instanceof UnsafeIdentifierError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'INVALID_REQUEST',
          category: 'SCENARIO_CONTRACT',
          message: 'Request validation failed.',
        },
      },
    };
  }
  if (error instanceof DomainPolicyError) {
    return {
      statusCode: 403,
      body: {
        error: {
          code: error.code,
          category: 'ENVIRONMENT',
          message: error.message,
        },
      },
    };
  }
  if (error instanceof AuthenticationBlockedError) {
    return {
      statusCode: error.category === 'ENVIRONMENT' ? 403 : 502,
      body: {
        error: {
          code: error.code,
          category: error.category,
          message: error.message,
        },
      },
    };
  }
  if (error instanceof LiveRunBlockedError) {
    return {
      statusCode:
        error.code === 'LIVE_RUN_IN_PROGRESS' || error.code === 'LIVE_RUN_REQUIRES_RECOVERY'
          ? 409
          : 403,
      body: {
        error: {
          code: error.code,
          category: error.category,
          message: error.message,
        },
      },
    };
  }
  if (error instanceof StorageCorruptionError) {
    return {
      statusCode: 500,
      body: {
        error: {
          code: 'STORAGE_CORRUPTION',
          category: 'PERSISTENCE',
          message: error.message,
        },
      },
    };
  }
  if (error instanceof RunIdAlreadyExistsError) {
    return {
      statusCode: 409,
      body: {
        error: {
          code: error.code,
          category: error.category,
          message: error.message,
        },
      },
    };
  }
  if (error instanceof Error && error.message.includes('was not found')) {
    return {
      statusCode: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          category: 'SCENARIO_CONTRACT',
          message: 'The requested resource was not found.',
        },
      },
    };
  }
  if (
    error instanceof Error &&
    (error.message.startsWith('Unknown ') || error.message.includes('variation'))
  ) {
    return {
      statusCode: 422,
      body: {
        error: {
          code: 'COMPILATION_REJECTED',
          category: 'SCENARIO_CONTRACT',
          message: 'The requested scenario variation could not be compiled.',
        },
      },
    };
  }
  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        category: 'ADAPTER',
        message: 'The request could not be completed.',
      },
    },
  };
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const rootDir = options.rootDir ?? process.cwd();
  const runtimePaths = options.runtimePaths ?? resolveRuntimePaths(rootDir);
  const core = options.core ?? createCore(rootDir, options.fetchImplementation);
  const idFactory = options.idFactory ?? defaultRunId;
  const clock = options.clock ?? (() => new Date().toISOString());
  const servesWeb = existsSync(path.join(runtimePaths.webDir, 'index.html'));

  if (servesWeb) {
    void app.register(fastifyStatic, {
      root: runtimePaths.webDir,
      prefix: '/',
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?', 1)[0] ?? request.url;
    if (servesWeb && request.method === 'GET' && !pathname.startsWith('/api')) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    void reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        category: 'SCENARIO_CONTRACT',
        message: 'The requested resource was not found.',
      },
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    const response = safeError(error);
    void reply.status(response.statusCode).send(response.body);
  });

  const liveness = {
    schemaVersion: 'nvs.liveness/v1' as const,
    status: 'ok',
    scope: 'LOCAL_CONTROL_PLANE',
  };

  app.get('/api/health/live', async () => liveness);
  app.get('/api/health', async () => liveness);

  app.get('/api/health/ready', async (_request, reply) => {
    const readiness = await checkLocalReadiness(runtimePaths);
    if (readiness.status !== 'ready') {
      void reply.status(503);
    }
    return readiness;
  });

  app.get('/api/version', async () => buildInformation());

  app.get('/api/environments', async () => ({ items: await core.listEnvironments() }));

  app.post('/api/environments/:id/probe', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    return core.probeEnvironment(id);
  });

  app.get('/api/environments/:id/actors', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.listActorReadiness(id);
  });

  app.post('/api/environments/:id/auth-preflight', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    return core.runAuthenticationPreflight(id);
  });

  app.get('/api/environments/:id/execution-readiness', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const query = z
      .object({
        scenarioId: safeIdSchema.optional(),
        journey: safeIdSchema.optional(),
      })
      .strict()
      .parse(request.query);
    return core.executionReadiness({
      environmentId: id,
      ...(query.scenarioId ? { scenarioId: query.scenarioId } : {}),
      ...(query.journey ? { variationValues: { journey: query.journey } } : {}),
    });
  });

  app.get('/api/scenarios', async () => ({ items: await core.listScenarios() }));

  app.get('/api/scenarios/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.getScenario(id);
  });

  app.post('/api/scenarios/:id/compile', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = compileBodySchema.parse(request.body ?? {});
    return core.compileScenario(id, body.variationValues);
  });

  app.post('/api/runs', async (request, reply) => {
    const body = createRunBodySchema.parse(request.body);
    const runId = body.runId ?? idFactory();
    if (body.runType === 'COMPILE_ONLY') {
      const run = await core.createCompileOnlyRun({
        runId,
        environmentId: body.environmentId,
        scenarioId: body.scenarioId,
        variationValues: body.variationValues,
        now: clock(),
      });
      void reply.status(201);
      return run;
    }
    const accepted = await core.startLiveApiRun({
      runId,
      environmentId: body.environmentId,
      scenarioId: body.scenarioId,
      variationValues: body.variationValues,
      confirmRealMutation: body.confirmRealMutation,
      now: clock(),
    });
    void reply.status(202);
    return accepted;
  });

  app.get('/api/runs', async () => ({ items: await core.listRuns() }));

  app.get('/api/runs/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.getRun(id);
  });

  app.get('/api/runs/:id/plan', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.getPlan(id);
  });

  app.get('/api/runs/:id/evidence', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.getEvidence(id);
  });

  app.get('/api/runs/:id/progress', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.getRunProgress(id);
  });

  app.get('/api/runs/:id/inventory', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return core.getResourceInventory(id);
  });

  app.get('/api/coverage', async () => core.coverage());

  return app;
}
