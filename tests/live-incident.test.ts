import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NvsCore,
  type ActorAuthenticator,
  type ActorProfileRepository,
  type ActorSession,
  type AuthenticationCredential,
  type EnvironmentRepository,
  type NilesIncidentLiveAdapter,
  type NilesIncidentRecord,
  type ScenarioRepository,
  type SecretProvider,
} from '@nvs/core';
import type {
  ActorProfileV1,
  EnvironmentActorMapV1,
  EnvironmentDefinitionV1,
  NilesIncidentFixtureV1,
} from '@nvs/contracts';
import {
  FilesystemRunBundleRepository,
  FilesystemScenarioRepository,
} from '@nvs/storage-filesystem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tenantId = '33333333-3333-4333-8333-333333333333';
const userIds = {
  requester: '11111111-1111-4111-8111-111111111111',
  serviceDesk: '22222222-2222-4222-8222-222222222222',
  incidentManager: '33333333-3333-4333-8333-333333333334',
  tenantAdmin: '44444444-4444-4444-8444-444444444444',
};

const liveEnvironment: EnvironmentDefinitionV1 = {
  schemaVersion: 'nvs.environment/v1',
  id: 'live-test',
  displayName: 'Live test',
  baseUrl: 'https://niles-live-test.invalid',
  kind: 'staging',
  healthPath: '/health/live',
  capabilities: { health: true, readiness: false, openApi: false, version: false },
  execution: {
    schemaVersion: 'nvs.environment-execution-policy/v1',
    liveApiEnabled: true,
    allowedRunTypes: ['COMPILE_ONLY', 'LIVE_API'],
    fixtureProfileRef: 'fixture.incident-payment',
    liveRunAllowlist: [
      {
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
      },
    ],
  },
  enabled: true,
};

const fixture: NilesIncidentFixtureV1 = {
  schemaVersion: 'nvs.niles-incident-fixture/v1',
  id: 'fixture.incident-payment',
  environmentId: 'live-test',
  enabled: true,
  tenantId,
  runNamespacePrefix: 'nvs-m1-02b',
  scenarioAllowlist: [
    {
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
    },
  ],
  resources: {
    assignmentGroup: { id: '55555555-5555-4555-8555-555555555555' },
    service: { id: '66666666-6666-4666-8666-666666666666' },
    offering: { id: '77777777-7777-4777-8777-777777777777' },
    configurationItem: { id: '88888888-8888-4888-8888-888888888888' },
    impact: 'high',
    urgency: 'high',
    expectedPriority: 'p1',
    hold: {
      pendingReason: 'external_provider',
      pendingReasonDetail: 'Waiting for provider data.',
    },
    resolutionNotes: 'Synthetic resolution notes confirm restored payment processing.',
    closeAuthority: {
      strategy: 'BLOCK_IF_UNSATISFIABLE',
      requesterMustHaveIncidentWrite: false,
    },
    sla: {
      required: true,
      policyRef: 'fixture.payment-api-sla',
      objectiveTypes: ['response', 'resolution'],
    },
  },
  cleanup: {
    onPass: 'RETAIN_CLOSED',
    onFail: 'RETAIN_FOR_DIAGNOSIS',
    onBlockedBeforeClose: 'DELETE_IF_RUN_OWNED',
  },
  provenance: {
    source: 'test fixture',
    grcCommit: '33af470e10fa753b79e092d9a99ef4f570854b10',
  },
};

class StaticEnvironmentRepository implements EnvironmentRepository {
  constructor(private readonly environments: EnvironmentDefinitionV1[]) {}

  async list() {
    return this.environments;
  }

  async get(id: string) {
    return this.environments.find((environment) => environment.id === id);
  }
}

class StaticFixtureRepository {
  constructor(private readonly currentFixture: NilesIncidentFixtureV1 | undefined) {}

  async getForEnvironment(environmentId: string) {
    return this.currentFixture?.environmentId === environmentId ? this.currentFixture : undefined;
  }
}

class StaticActorRepository implements ActorProfileRepository {
  private readonly profiles: ActorProfileV1[] = (
    [
      ['requester', 'requester'],
      ['service-desk-agent', 'service-desk-agent'],
      ['incident-manager', 'incident-manager'],
      ['tenant-admin', 'tenant-admin'],
      ['cross-tenant-agent', 'cross-tenant-agent'],
    ] as const
  ).map(([persona, suffix]) => ({
    schemaVersion: 'nvs.actor-profile/v1',
    id: `live-${suffix}`,
    displayName: `Live ${suffix}`,
    persona,
    environmentId: 'live-test',
    tenantId,
    credentialRef: `niles.live.${suffix}`,
    expectedDomains: ['itsm'],
    expectedRoles: [suffix],
    capabilityNotes: ['Synthetic test actor.'],
    enabled: true,
    mfa: 'NOT_EXPECTED',
    provenance: { source: 'test' },
  }));

  async getForEnvironment() {
    const mapping: EnvironmentActorMapV1 = {
      schemaVersion: 'nvs.environment-actor-map/v1',
      environmentId: 'live-test',
      actors: {
        requester: 'live-requester',
        'service-desk-agent': 'live-service-desk-agent',
        'incident-manager': 'live-incident-manager',
        'tenant-admin': 'live-tenant-admin',
        'cross-tenant-agent': 'live-cross-tenant-agent',
      },
      provenance: { source: 'test' },
    };
    return { mapping, profiles: this.profiles };
  }
}

class StaticSecrets implements SecretProvider {
  async configurationStatus() {
    return 'CONFIGURED' as const;
  }

  async resolve(): Promise<AuthenticationCredential> {
    return {
      async use<T>(operation: (email: string, password: string) => Promise<T>) {
        return operation('actor@example.invalid', 'password');
      },
      destroy() {},
      toJSON() {
        return '[redacted]';
      },
    };
  }
}

class FakeSession implements ActorSession {
  destroyed = false;

  constructor(
    readonly actorProfileId: string,
    readonly userId: string,
    readonly tenantId: string | undefined,
    readonly correlationId: string,
  ) {}

  async withAuthorization<T>(operation: (authorization: string) => Promise<T>) {
    return operation('Bearer fake-token');
  }

  destroy() {
    this.destroyed = true;
  }

  toJSON() {
    return { actorProfileId: this.actorProfileId, userId: this.userId, destroyed: this.destroyed };
  }
}

class FakeAuthenticator implements ActorAuthenticator {
  async authenticate(input: { profile: ActorProfileV1; correlationId: string }) {
    const userId =
      input.profile.persona === 'requester'
        ? userIds.requester
        : input.profile.persona === 'service-desk-agent'
          ? userIds.serviceDesk
          : input.profile.persona === 'incident-manager'
            ? userIds.incidentManager
            : userIds.tenantAdmin;
    return new FakeSession(input.profile.id, userId, tenantId, input.correlationId);
  }
}

class StatefulIncidentAdapter implements NilesIncidentLiveAdapter {
  closeCalled = false;
  deleted = false;
  incident: NilesIncidentRecord = {
    id: '99999999-9999-4999-8999-999999999999',
    number: 'INC-NVS-1',
    status: 'open' as const,
    priority: 'p1' as const,
    assignmentGroupId: fixture.resources.assignmentGroup.id,
    requesterId: userIds.requester,
  };

  async verifyResource(input: { id: string }) {
    return { id: input.id };
  }

  async createIncident() {
    return this.incident;
  }

  async readIncident() {
    return this.incident;
  }

  async assignIncident(input: { assignmentGroupId: string }) {
    this.incident = { ...this.incident, assignmentGroupId: input.assignmentGroupId };
    return this.incident;
  }

  async takeOwnership() {
    this.incident = { ...this.incident, assignedTo: userIds.serviceDesk, status: 'in_progress' };
    return this.incident;
  }

  async startWork() {
    this.incident = { ...this.incident, status: 'in_progress' };
    return this.incident;
  }

  async addAffectedCi() {}

  async readSlaSummary() {
    return { records: [{ id: 'sla-1', objectiveType: 'response', status: 'running' }] };
  }

  async readJournalSummary() {
    return { count: 5 };
  }

  async holdIncident() {
    this.incident = { ...this.incident, status: 'on_hold' };
    return this.incident;
  }

  async resumeIncident() {
    this.incident = { ...this.incident, status: 'in_progress' };
    return this.incident;
  }

  async resolveIncident() {
    this.incident = { ...this.incident, status: 'resolved' };
    return this.incident;
  }

  async closeIncident() {
    this.closeCalled = true;
    this.incident = { ...this.incident, status: 'closed' };
    return this.incident;
  }

  async softDeleteIncident() {
    this.deleted = true;
  }

  async verifyIncidentDeleted() {
    return this.deleted;
  }
}

let temporaryRoot: string;
const repositoryRoot = process.cwd();

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nvs-live-'));
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

function buildCore(adapter: StatefulIncidentAdapter, environment = liveEnvironment) {
  const scenarios: ScenarioRepository = new FilesystemScenarioRepository(
    path.join(repositoryRoot, 'scenarios'),
  );
  return new NvsCore(
    new StaticEnvironmentRepository([environment]),
    scenarios,
    new FilesystemRunBundleRepository(temporaryRoot),
    {
      async probe(probeEnvironment) {
        return {
          environmentId: probeEnvironment.id,
          verdict: 'PASS',
          health: { available: true, status: 200 },
          readiness: { available: false },
          openApi: { available: false },
          version: { available: false, source: 'NONE' },
        };
      },
    },
    {
      profiles: new StaticActorRepository(),
      secrets: new StaticSecrets(),
      authenticator: new FakeAuthenticator(),
      clock: () => '2026-07-15T12:00:00.000Z',
      correlationIdFactory: () => 'corr_live_test',
    },
    {
      fixtures: new StaticFixtureRepository(fixture),
      incidentAdapter: adapter,
      mutationsEnabled: () => true,
      clock: () => '2026-07-15T12:00:00.000Z',
      correlationIdFactory: (seed) => `live_${seed.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    },
  );
}

describe('live Incident API orchestration', () => {
  it('blocks production readiness before fixture or actor access', async () => {
    const fixtures = new StaticFixtureRepository(fixture);
    const fixtureSpy = vi.spyOn(fixtures, 'getForEnvironment');
    const core = new NvsCore(
      new StaticEnvironmentRepository([{ ...liveEnvironment, id: 'prod', kind: 'production' }]),
      new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
      new FilesystemRunBundleRepository(temporaryRoot),
      {
        probe: async () => ({
          environmentId: 'prod',
          verdict: 'PASS',
          health: { available: true },
          readiness: { available: false },
          openApi: { available: false },
          version: { available: false, source: 'NONE' },
        }),
      },
      {
        profiles: new StaticActorRepository(),
        secrets: new StaticSecrets(),
        authenticator: new FakeAuthenticator(),
      },
      {
        fixtures,
        incidentAdapter: new StatefulIncidentAdapter(),
        mutationsEnabled: () => true,
      },
    );

    const readiness = await core.executionReadiness({ environmentId: 'prod' });

    expect(readiness.verdict).toBe('BLOCKED');
    expect(readiness.error?.code).toBe('PRODUCTION_MUTATION_FORBIDDEN');
    expect(fixtureSpy).not.toHaveBeenCalled();
  });

  it('persists BLOCKED close-authority evidence and verified run-owned cleanup', async () => {
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-close-blocked',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.schemaVersion).toBe('nvs.run/v2');
    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('NILES_CLOSE_AUTHORITY_UNSATISFIABLE');
    expect(run.cleanup).toMatchObject({ status: 'CLEAN', policy: 'DELETE_IF_RUN_OWNED' });
    expect(run.resourceInventory.incident?.disposition).toBe('DELETED');
    expect(adapter.closeCalled).toBe(false);
    expect(adapter.deleted).toBe(true);

    const progress = await core.getRunProgress(run.runId);
    expect(progress.observations.at(-1)).toMatchObject({
      sourceStepId: 'close-resolved-incident',
      status: 'BLOCKED',
      error: { code: 'NILES_CLOSE_AUTHORITY_UNSATISFIABLE' },
    });
    await expect(core.getResourceInventory(run.runId)).resolves.toMatchObject({
      incident: { disposition: 'DELETED' },
    });
    expect(JSON.stringify(await core.getEvidence(run.runId))).not.toMatch(
      /fake-token|actor@example|synthetic-test-value/i,
    );
  });
});
