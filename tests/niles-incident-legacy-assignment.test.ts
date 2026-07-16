import { NilesIncidentApiAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import type { ActorSession } from '@nvs/core';
import type { EnvironmentDefinitionV1 } from '@nvs/contracts';
import { describe, expect, it, vi } from 'vitest';

const tenantId = '33333333-3333-4333-8333-333333333333';
const requesterId = '11111111-1111-4111-8111-111111111111';
const incidentId = '99999999-9999-4999-8999-999999999999';
const assignmentLabel = 'NVS Service Desk';

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

describe('NILES legacy assignment-label adapter contract', () => {
  it('sends and normalizes the legacy assignment label for create and assign', async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: incidentId,
            number: 'INC-NVS-LEGACY-1',
            status: 'open',
            priority: 'p1',
            requesterId,
            assignmentGroup: assignmentLabel,
            assignmentGroupId: null,
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: incidentId,
            number: 'INC-NVS-LEGACY-1',
            status: 'open',
            priority: 'p1',
            requesterId,
            assignmentGroup: assignmentLabel,
            assignmentGroupId: null,
          }),
          { status: 200 },
        ),
      );
    const adapter = new NilesIncidentApiAdapter(fetchMock, 100);

    const created = await adapter.createIncident({
      environment,
      session,
      tenantId,
      correlationId: 'create-legacy-assignment',
      runId: 'live-legacy-assignment',
      runNamespacePrefix: 'nvs-m1-02b',
      requesterUserId: requesterId,
      assignmentGroup: assignmentLabel,
      serviceId: '66666666-6666-4666-8666-666666666666',
      impact: 'high',
      urgency: 'high',
    });
    const assigned = await adapter.assignIncident({
      environment,
      session,
      tenantId,
      incidentId,
      assignmentGroup: assignmentLabel,
      correlationId: 'assign-legacy-assignment',
    });

    expect(created).toMatchObject({
      id: incidentId,
      assignmentGroup: assignmentLabel,
    });
    expect(assigned).toMatchObject({
      id: incidentId,
      assignmentGroup: assignmentLabel,
    });

    const createBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const assignBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(createBody).toMatchObject({ assignmentGroup: assignmentLabel });
    expect(assignBody).toEqual({ assignmentGroup: assignmentLabel });
    expect(createBody).not.toHaveProperty('assignmentGroupId');
    expect(assignBody).not.toHaveProperty('assignmentGroupId');
  });

  it('rejects an assignment operation that supplies neither representation before network access', async () => {
    const fetchMock = vi.fn<FetchImplementation>();
    const adapter = new NilesIncidentApiAdapter(fetchMock, 100);

    await expect(
      adapter.assignIncident({
        environment,
        session,
        tenantId,
        incidentId,
        correlationId: 'assign-without-binding',
      }),
    ).rejects.toMatchObject({
      code: 'NILES_MALFORMED_RESPONSE',
      category: 'ADAPTER',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
