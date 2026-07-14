import { NilesReadOnlyAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import type { EnvironmentDefinitionV1 } from '@nvs/contracts';
import { describe, expect, it, vi } from 'vitest';

const environment: EnvironmentDefinitionV1 = {
  schemaVersion: 'nvs.environment/v1',
  id: 'adapter-test',
  displayName: 'Adapter test',
  baseUrl: 'https://niles.invalid',
  kind: 'test',
  healthPath: '/health/live',
  readinessPath: '/health/ready',
  openApiPath: '/api/docs-json',
  versionPath: '/health/version',
  capabilities: { health: true, readiness: true, openApi: true, version: true },
  enabled: true,
};

describe('read-only NILES adapter', () => {
  it('uses only GET and reports health, readiness, OpenAPI, and build capabilities', async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ openapi: '3.1.0', info: { version: '2026.07' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              status: 'ok',
              version: {
                commitSha: '33af470e10fa753b79e092d9a99ef4f570854b10',
                commitShort: '33af470',
                buildTimestamp: '2026-07-14T12:00:00.000Z',
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await new NilesReadOnlyAdapter(fetchMock).probe(environment);

    expect(result).toMatchObject({
      verdict: 'PASS',
      health: { available: true, status: 200 },
      readiness: { available: true, status: 200, state: 'ok' },
      openApi: { available: true, status: 200 },
      version: {
        available: true,
        commit: '33af470e10fa753b79e092d9a99ef4f570854b10',
        buildTimestamp: '2026-07-14T12:00:00.000Z',
        source: 'HEALTH_VERSION',
      },
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://niles.invalid/health/live',
      'https://niles.invalid/health/ready',
      'https://niles.invalid/api/docs-json',
      'https://niles.invalid/health/version',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      'GET',
      'GET',
      'GET',
      'GET',
    ]);
    expect(
      fetchMock.mock.calls.every(([, init]) => ['GET', 'HEAD'].includes(String(init?.method))),
    ).toBe(true);
  });

  it('does not crash when optional OpenAPI is unavailable', async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    const result = await new NilesReadOnlyAdapter(fetchMock).probe(environment);

    expect(result.verdict).toBe('PASS');
    expect(result.readiness).toEqual({ available: true, status: 200, state: 'ok' });
    expect(result.openApi).toEqual({ available: false, status: 404 });
    expect(result.version).toEqual({ available: false, status: 404, source: 'NONE' });
  });

  it('classifies required health failure as an environment BLOCKED result', async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    const result = await new NilesReadOnlyAdapter(fetchMock).probe(environment);

    expect(result.verdict).toBe('BLOCKED');
    expect(result.error).toMatchObject({
      category: 'ENVIRONMENT',
      code: 'HEALTH_FAILED',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks when the confirmed readiness endpoint reports degradation', async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'degraded' }), { status: 200 }));

    const result = await new NilesReadOnlyAdapter(fetchMock).probe(environment);

    expect(result.verdict).toBe('BLOCKED');
    expect(result.readiness).toEqual({
      available: true,
      status: 200,
      state: 'degraded',
    });
    expect(result.error?.code).toBe('READINESS_DEGRADED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies a network failure without leaking transport details', async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockRejectedValue(new Error('secret host detail'));

    const result = await new NilesReadOnlyAdapter(fetchMock).probe(environment);

    expect(result.verdict).toBe('BLOCKED');
    expect(result.error?.code).toBe('HEALTH_UNREACHABLE');
    expect(JSON.stringify(result)).not.toContain('secret host detail');
  });
});
