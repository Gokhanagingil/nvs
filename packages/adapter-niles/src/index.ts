import {
  probeResultV1Schema,
  type EnvironmentDefinitionV1,
  type ProbeResultV1,
} from '@nvs/contracts';
import type { EnvironmentProbe } from '@nvs/core';

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ReadinessResult = {
  readiness: { available: boolean; status?: number; state?: string };
  error?: {
    category: 'ENVIRONMENT';
    code: string;
    message: string;
    retryable: boolean;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function unwrapPayload(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  return asRecord(root?.['data']) ?? root;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function optionalReadiness(
  environment: EnvironmentDefinitionV1,
  fetchImplementation: FetchImplementation,
): Promise<ReadinessResult> {
  if (!environment.readinessPath || !environment.capabilities.readiness) {
    return { readiness: { available: false } };
  }

  try {
    const response = await fetchImplementation(
      new URL(environment.readinessPath, environment.baseUrl),
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) {
      return {
        readiness: { available: false, status: response.status },
        error: {
          category: 'ENVIRONMENT',
          code: 'READINESS_FAILED',
          message: 'Required NILES readiness capability returned a non-success status.',
          retryable: response.status >= 500,
        },
      };
    }

    const payload = unwrapPayload(await readJson(response));
    const state =
      typeof payload?.['status'] === 'string' ? payload['status'].toLowerCase() : undefined;
    if (state !== 'ok' && state !== 'healthy') {
      return {
        readiness: {
          available: true,
          status: response.status,
          ...(state ? { state } : {}),
        },
        error: {
          category: 'ENVIRONMENT',
          code: state === 'degraded' ? 'READINESS_DEGRADED' : 'READINESS_UNRECOGNIZED',
          message:
            state === 'degraded'
              ? 'NILES reports degraded readiness.'
              : 'NILES readiness response could not be classified safely.',
          retryable: true,
        },
      };
    }

    return {
      readiness: { available: true, status: response.status, state },
    };
  } catch {
    return {
      readiness: { available: false },
      error: {
        category: 'ENVIRONMENT',
        code: 'READINESS_UNREACHABLE',
        message: 'Required NILES readiness capability is unreachable.',
        retryable: true,
      },
    };
  }
}

async function optionalOpenApi(
  environment: EnvironmentDefinitionV1,
  fetchImplementation: FetchImplementation,
): Promise<{ available: boolean; status?: number }> {
  if (!environment.openApiPath || !environment.capabilities.openApi) {
    return { available: false };
  }

  try {
    const response = await fetchImplementation(
      new URL(environment.openApiPath, environment.baseUrl),
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) {
      return { available: false, status: response.status };
    }
    return { available: true, status: response.status };
  } catch {
    return { available: false };
  }
}

async function optionalVersion(
  environment: EnvironmentDefinitionV1,
  fetchImplementation: FetchImplementation,
): Promise<{
  available: boolean;
  status?: number;
  commit?: string;
  buildTimestamp?: string;
  source: 'NONE' | 'HEALTH_VERSION';
}> {
  if (!environment.versionPath || !environment.capabilities.version) {
    return { available: false, source: 'NONE' };
  }

  try {
    const response = await fetchImplementation(
      new URL(environment.versionPath, environment.baseUrl),
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) {
      return { available: false, status: response.status, source: 'NONE' };
    }

    const payload = unwrapPayload(await readJson(response));
    const version = asRecord(payload?.['version']);
    const fullCommit =
      typeof version?.['commitSha'] === 'string' && version['commitSha'] !== 'unknown'
        ? version['commitSha']
        : undefined;
    const shortCommit =
      typeof version?.['commitShort'] === 'string' && version['commitShort'] !== 'unknown'
        ? version['commitShort']
        : undefined;
    const buildTimestamp =
      typeof version?.['buildTimestamp'] === 'string' && version['buildTimestamp'] !== 'unknown'
        ? version['buildTimestamp']
        : undefined;
    const commit = fullCommit ?? shortCommit;
    const available = Boolean(commit || buildTimestamp);

    return {
      available,
      status: response.status,
      ...(commit ? { commit } : {}),
      ...(buildTimestamp ? { buildTimestamp } : {}),
      source: available ? 'HEALTH_VERSION' : 'NONE',
    };
  } catch {
    return { available: false, source: 'NONE' };
  }
}

export class NilesReadOnlyAdapter implements EnvironmentProbe {
  constructor(private readonly fetchImplementation: FetchImplementation = fetch) {}

  async probe(environment: EnvironmentDefinitionV1): Promise<ProbeResultV1> {
    let healthResponse: Response;
    try {
      healthResponse = await this.fetchImplementation(
        new URL(environment.healthPath, environment.baseUrl),
        {
          method: 'GET',
          headers: { accept: 'application/json' },
        },
      );
    } catch {
      return probeResultV1Schema.parse({
        environmentId: environment.id,
        verdict: 'BLOCKED',
        health: { available: false },
        readiness: { available: false },
        openApi: { available: false },
        version: { available: false, source: 'NONE' },
        error: {
          category: 'ENVIRONMENT',
          code: 'HEALTH_UNREACHABLE',
          message: 'Required NILES health capability is unreachable.',
          retryable: true,
        },
      });
    }

    if (!healthResponse.ok) {
      return probeResultV1Schema.parse({
        environmentId: environment.id,
        verdict: 'BLOCKED',
        health: { available: false, status: healthResponse.status },
        readiness: { available: false },
        openApi: { available: false },
        version: { available: false, source: 'NONE' },
        error: {
          category: 'ENVIRONMENT',
          code: 'HEALTH_FAILED',
          message: 'Required NILES health capability returned a non-success status.',
          retryable: healthResponse.status >= 500,
        },
      });
    }

    const readiness = await optionalReadiness(environment, this.fetchImplementation);
    if (readiness.error) {
      return probeResultV1Schema.parse({
        environmentId: environment.id,
        verdict: 'BLOCKED',
        health: { available: true, status: healthResponse.status },
        readiness: readiness.readiness,
        openApi: { available: false },
        version: { available: false, source: 'NONE' },
        error: readiness.error,
      });
    }

    const [openApi, version] = await Promise.all([
      optionalOpenApi(environment, this.fetchImplementation),
      optionalVersion(environment, this.fetchImplementation),
    ]);
    return probeResultV1Schema.parse({
      environmentId: environment.id,
      verdict: 'PASS',
      health: { available: true, status: healthResponse.status },
      readiness: readiness.readiness,
      openApi,
      version,
    });
  }
}
