import path from 'node:path';
import { NilesReadOnlyAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import { safeIdSchema } from '@nvs/contracts';
import { NvsCore } from '@nvs/core';
import { DomainPolicyError } from '@nvs/domain';
import {
  FilesystemEnvironmentRepository,
  FilesystemEvidenceRepository,
  FilesystemRunRepository,
  FilesystemScenarioRepository,
  StorageCorruptionError,
  UnsafeIdentifierError,
} from '@nvs/storage-filesystem';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';

const idParamsSchema = z.object({ id: safeIdSchema }).strict();
const compileBodySchema = z
  .object({
    variationValues: z.record(safeIdSchema, safeIdSchema).default({}),
  })
  .strict();
const createRunBodySchema = z
  .object({
    runType: z.literal('COMPILE_ONLY'),
    runId: safeIdSchema.optional(),
    environmentId: safeIdSchema,
    scenarioId: safeIdSchema,
    variationValues: z.record(safeIdSchema, safeIdSchema).default({}),
  })
  .strict();
const emptyBodySchema = z.object({}).strict();

export interface BuildAppOptions {
  rootDir?: string;
  core?: NvsCore;
  fetchImplementation?: FetchImplementation;
  idFactory?: () => string;
  clock?: () => string;
}

let runSequence = 0;
function defaultRunId(): string {
  runSequence += 1;
  return `run_${Date.now().toString(36)}_${runSequence.toString(36)}`;
}

export function createCore(rootDir: string, fetchImplementation?: FetchImplementation): NvsCore {
  const artifactRoot = path.join(rootDir, 'artifacts');
  return new NvsCore(
    new FilesystemEnvironmentRepository(path.join(rootDir, 'environments')),
    new FilesystemScenarioRepository(path.join(rootDir, 'scenarios')),
    new FilesystemRunRepository(artifactRoot),
    new FilesystemEvidenceRepository(artifactRoot),
    new NilesReadOnlyAdapter(fetchImplementation),
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
  const app = Fastify({ logger: false });
  const rootDir = options.rootDir ?? process.cwd();
  const core = options.core ?? createCore(rootDir, options.fetchImplementation);
  const idFactory = options.idFactory ?? defaultRunId;
  const clock = options.clock ?? (() => new Date().toISOString());

  app.setNotFoundHandler((_request, reply) => {
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

  app.get('/api/health', async () => ({
    schemaVersion: 'nvs.api-health/v1',
    status: 'ok',
    scope: 'LOCAL_CONTROL_PLANE',
  }));

  app.get('/api/environments', async () => ({ items: await core.listEnvironments() }));

  app.post('/api/environments/:id/probe', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    return core.probeEnvironment(id);
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
    const run = await core.createCompileOnlyRun({
      runId: body.runId ?? idFactory(),
      environmentId: body.environmentId,
      scenarioId: body.scenarioId,
      variationValues: body.variationValues,
      now: clock(),
    });
    void reply.status(201);
    return run;
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

  app.get('/api/coverage', async () => core.coverage());

  return app;
}
