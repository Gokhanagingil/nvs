import { NilesIncidentApiAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import type { ActorSession } from '@nvs/core';
import type { EnvironmentDefinitionV1 } from '@nvs/contracts';
import { describe, expect, it, vi } from 'vitest';

const tenantId = '33333333-3333-4333-8333-333333333333';
const requesterId = '11111111-1111-4111-8111-111111111111';
const incidentId = '99999999-9999-4999-8999-999999999999';

const environment: EnvironmentDefinitionV1 = {
  schemaVersion: 'nvs.environment/v1',
  id: 'live-test',
  displayName: 'Live test',
  baseUrl: 'https://niles-live-test.invalid',
  kind: 'staging',
  healthPath: '/health/live',
  capabilities: { health: true, readiness: false, openApi: false, version: false },
  enabled: true,
};

const session: ActorSession = {
  actorProfileId: 'live-service-desk-agent',
  userId: requesterId,
  tenantId,
  correlationId: 'session-correlation',
  destroyed: false,
  async withAuthorization<T>(operation: (authorization: string) => Promise<T>) {
    return operation('Bearer dummy-redaction-token');
  },
  destroy() {},
  toJSON() {
    return { actorProfileId: this.actorProfileId, userId: this.userId };
  },
};

function hangsUntilAborted(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener(
      'abort',
      () => reject(new DOMException('transport detail', 'AbortError')),
      { once: true },
    );
  });
}

describe('NILES incident live API adapter', () => {
  it('persists typed sanitized transport evidence and uses the fixture namespace marker', async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: incidentId,
          number: 'INC-NVS-1',
          status: 'open',
          priority: 'p1',
          requesterId,
        }),
        { status: 201 },
      ),
    );
    const adapter = new NilesIncidentApiAdapter(fetchMock, 100);

    const incident = await adapter.createIncident({
      environment,
      session,
      tenantId,
      correlationId: 'create-correlation',
      runId: 'live-run-1',
      runNamespacePrefix: 'nvs-m1-02b',
      requesterUserId: requesterId,
      assignmentGroupId: '55555555-5555-4555-8555-555555555555',
      serviceId: '66666666-6666-4666-8666-666666666666',
      impact: 'high',
      urgency: 'high',
    });

    expect(incident.transport).toEqual(
      expect.objectContaining({
        method: 'POST',
        pathTemplate: '/grc/itsm/incidents',
        httpStatus: 201,
        correlationId: 'create-correlation',
      }),
    );
    expect(JSON.stringify(incident.transport)).not.toMatch(
      /dummy-redaction-token|authorization|cookie|requesterId|assignmentGroupId/i,
    );

    const [, requestInit] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(requestInit?.body));
    expect(body.shortDescription).toContain('nvs-m1-02b-live-run-1');
    expect(body.metadata.nvs).toMatchObject({
      runId: 'live-run-1',
      runNamespacePrefix: 'nvs-m1-02b',
      synthetic: true,
    });
  });

  it.each([
    [400, 'NILES_PRODUCT_RULE_REJECTED', 'PRODUCT', false],
    [401, 'NILES_AUTHORIZATION_DENIED', 'ENVIRONMENT', false],
    [403, 'NILES_AUTHORIZATION_DENIED', 'ENVIRONMENT', false],
    [404, 'NILES_RESOURCE_MISSING', 'ENVIRONMENT', false],
    [409, 'NILES_CONFLICT', 'PRODUCT', false],
    [429, 'NILES_RATE_LIMITED', 'ADAPTER', true],
    [500, 'NILES_UPSTREAM_FAILURE', 'ADAPTER', true],
    [502, 'NILES_UPSTREAM_FAILURE', 'ADAPTER', true],
  ] as const)(
    'maps HTTP %s to stable typed error %s',
    async (httpStatus, code, category, retryable) => {
      const fetchMock = vi
        .fn<FetchImplementation>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'failure' }), { status: httpStatus }),
        );
      const adapter = new NilesIncidentApiAdapter(fetchMock, 100);

      await expect(
        adapter.readIncident({
          environment,
          session,
          tenantId,
          incidentId,
          correlationId: `read-${httpStatus}`,
        }),
      ).rejects.toMatchObject({ code, category, retryable });
    },
  );

  it('maps network failures and malformed 2xx payloads to stable adapter errors', async () => {
    const networkAdapter = new NilesIncidentApiAdapter(
      vi.fn<FetchImplementation>().mockRejectedValue(new Error('network down')),
      100,
    );
    await expect(
      networkAdapter.readIncident({
        environment,
        session,
        tenantId,
        incidentId,
        correlationId: 'read-network',
      }),
    ).rejects.toMatchObject({
      code: 'NILES_NETWORK_FAILURE',
      category: 'ADAPTER',
      retryable: true,
      transport: expect.objectContaining({
        method: 'GET',
        pathTemplate: '/grc/itsm/incidents/:incidentId',
        correlationId: 'read-network',
      }),
    });

    const malformedAdapter = new NilesIncidentApiAdapter(
      vi
        .fn<FetchImplementation>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { number: 'INC-NVS-1' } }), { status: 200 }),
        ),
      100,
    );
    await expect(
      malformedAdapter.readIncident({
        environment,
        session,
        tenantId,
        incidentId,
        correlationId: 'read-malformed',
      }),
    ).rejects.toMatchObject({
      code: 'NILES_MALFORMED_RESPONSE',
      category: 'ADAPTER',
      retryable: false,
      transport: expect.objectContaining({ httpStatus: 200 }),
    });
  });

  it('maps timeouts to a distinct retryable adapter error', async () => {
    vi.useFakeTimers();
    try {
      const timeoutAdapter = new NilesIncidentApiAdapter(
        vi.fn<FetchImplementation>(hangsUntilAborted),
        100,
      );
      const read = timeoutAdapter.readIncident({
        environment,
        session,
        tenantId,
        incidentId,
        correlationId: 'read-timeout',
      });
      const assertion = expect(read).rejects.toMatchObject({
        code: 'NILES_TIMEOUT',
        category: 'ADAPTER',
        retryable: true,
        transport: expect.objectContaining({
          method: 'GET',
          pathTemplate: '/grc/itsm/incidents/:incidentId',
          correlationId: 'read-timeout',
        }),
      });

      await vi.advanceTimersByTimeAsync(100);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses the real GRC journal response shape without inventing action fields', async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'journal-1',
              type: 'action',
              message: 'Incident resumed. Work returned to In Progress.',
              createdBy: requesterId,
              createdAt: '2026-07-15T12:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }),
        { status: 200 },
      ),
    );
    const adapter = new NilesIncidentApiAdapter(fetchMock, 100);

    const journal = await adapter.readJournalSummary({
      environment,
      session,
      tenantId,
      incidentId,
      correlationId: 'read-journal',
    });

    expect(journal).toMatchObject({
      count: 1,
      entries: [
        {
          id: 'journal-1',
          type: 'action',
          message: 'Incident resumed. Work returned to In Progress.',
          createdBy: requesterId,
          createdAt: '2026-07-15T12:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(journal)).not.toMatch(/"action":/);
  });
});
