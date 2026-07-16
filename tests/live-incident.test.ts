import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AuthenticationBlockedError,
  LiveRunBlockedError,
  NvsCore,
  type ActorAuthenticator,
  type ActorProfileRepository,
  type ActorSession,
  type AuthenticationCredential,
  type EnvironmentRepository,
  type LiveRunState,
  type LiveRunStateRepository,
  type NilesAffectedCiSummary,
  type NilesIncidentLiveAdapter,
  type NilesIncidentRecord,
  type NilesJournalSummary,
  type NilesSlaSummary,
  type ScenarioRepository,
  type SecretConfigurationStatus,
  type SecretProvider,
} from '@nvs/core';
import { NilesIncidentApiAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import type {
  ActorProfileV1,
  EnvironmentActorMapV1,
  EnvironmentDefinitionV1,
  NilesIncidentFixtureV1,
} from '@nvs/contracts';
import {
  FilesystemLiveRunStateRepository,
  FilesystemRunBundleRepository,
  FilesystemScenarioRepository,
  type BundlePersistenceHooks,
  type LiveStatePersistenceHooks,
} from '@nvs/storage-filesystem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tenantId = '33333333-3333-4333-8333-333333333333';
const assignmentGroupId = '55555555-5555-4555-8555-555555555555';
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
    assignmentGroup: { mode: 'CANONICAL_ID', id: assignmentGroupId },
    service: { id: '66666666-6666-4666-8666-666666666666' },
    offering: { id: '77777777-7777-4777-8777-777777777777' },
    configurationItem: { id: '88888888-8888-4888-8888-888888888888' },
    affectedCi: { relationshipType: 'affected_by', impactScope: 'service_impacting' },
    impact: 'high',
    urgency: 'high',
    expectedPriority: 'p1',
    hold: {
      pendingReason: 'pending_external_dependency',
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
  async configurationStatus(): Promise<SecretConfigurationStatus> {
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
  affectedCiIds = new Set<string>();
  operations: string[] = [];
  incident: NilesIncidentRecord = {
    id: '99999999-9999-4999-8999-999999999999',
    number: 'INC-NVS-1',
    status: 'open' as const,
    priority: 'p1' as const,
    assignmentGroupId: assignmentGroupId,
    requesterId: userIds.requester,
  };

  async verifyResource(input: { id: string }) {
    this.operations.push(`GET resource ${input.id}`);
    return {
      id: input.id,
      ...(input.id === fixture.resources.offering?.id
        ? { serviceId: fixture.resources.service.id }
        : {}),
      transport: {
        method: 'GET' as const,
        pathTemplate: '/fixture/:id',
        httpStatus: 200,
        durationMs: 1,
        correlationId: 'fixture_read',
      },
    };
  }

  async readChoiceValues(input: { field: 'pendingReason' | 'relationshipType' | 'impactScope' }) {
    this.operations.push(`GET choices ${input.field}`);
    const values =
      input.field === 'pendingReason'
        ? ['pending_external_dependency']
        : input.field === 'relationshipType'
          ? ['affected_by']
          : ['service_impacting'];
    return {
      values,
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/choices?table=:table&field=:field',
        httpStatus: 200,
        durationMs: 1,
        correlationId: `choice_${input.field}`,
      },
    };
  }

  async createIncident(input: {
    assignmentGroupId?: string;
    assignmentGroup?: string;
  }): Promise<NilesIncidentRecord> {
    this.operations.push('POST create incident');
    this.incident = {
      ...this.incident,
      assignmentGroupId: input.assignmentGroupId ?? null,
      assignmentGroup: input.assignmentGroup ?? null,
    };
    return {
      ...this.incident,
      transport: {
        method: 'POST' as const,
        pathTemplate: '/grc/itsm/incidents',
        httpStatus: 201,
        durationMs: 1,
        correlationId: 'create_incident',
      },
    };
  }

  async readIncident() {
    this.operations.push('GET incident');
    return {
      ...this.incident,
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/incidents/:incidentId',
        httpStatus: 200,
        durationMs: 1,
        correlationId: 'read_incident',
      },
    };
  }

  async assignIncident(input: { assignmentGroupId?: string; assignmentGroup?: string }) {
    this.incident = {
      ...this.incident,
      assignmentGroupId: input.assignmentGroupId ?? null,
      assignmentGroup: input.assignmentGroup ?? null,
    };
    return this.readIncident();
  }

  async takeOwnership() {
    this.incident = { ...this.incident, assignedTo: userIds.serviceDesk, status: 'in_progress' };
    return this.readIncident();
  }

  async startWork() {
    this.incident = { ...this.incident, status: 'in_progress' };
    return this.readIncident();
  }

  async addAffectedCi(input: { ciId: string; relationshipType: string; impactScope?: string }) {
    this.operations.push('POST affected CI');
    this.affectedCiIds.add(input.ciId);
    return {
      method: 'POST' as const,
      pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
      httpStatus: 201,
      durationMs: 1,
      correlationId: 'add_affected_ci',
    };
  }

  async listAffectedCis(): Promise<NilesAffectedCiSummary> {
    this.operations.push('GET affected CIs');
    return {
      items: [...this.affectedCiIds].map((ciId) => ({ ciId })),
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
        httpStatus: 200,
        durationMs: 1,
        correlationId: 'list_affected_cis',
      },
    };
  }

  async readSlaSummary(): Promise<NilesSlaSummary> {
    this.operations.push('GET SLA summary');
    const status =
      this.incident.status === 'on_hold'
        ? 'paused'
        : this.incident.status === 'resolved' || this.incident.status === 'closed'
          ? 'completed'
          : 'running';
    const policyEvidence = fixture.resources.sla.policyRef
      ? { policyRef: fixture.resources.sla.policyRef }
      : {};
    return {
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
        httpStatus: 200,
        durationMs: 1,
        correlationId: 'read_sla',
      },
      records: [
        { id: 'sla-1', objectiveType: 'response', status, ...policyEvidence },
        {
          id: 'sla-2',
          objectiveType: 'resolution',
          status,
          ...policyEvidence,
          ...(status === 'paused' ? { pauseAt: '2026-07-15T12:00:00.000Z' } : {}),
          ...(status === 'completed' ? { stopAt: '2026-07-15T12:00:00.000Z' } : {}),
        },
      ],
    };
  }

  async readJournalSummary(): Promise<NilesJournalSummary> {
    return {
      count: 5,
      entries: [
        {
          id: 'journal-1',
          type: 'action',
          message: 'Incident placed on hold. Waiting on External Provider.',
          createdBy: userIds.serviceDesk,
          createdAt: '2026-07-15T12:00:00.000Z',
        },
        {
          id: 'journal-2',
          type: 'action',
          message:
            'Incident resumed. Work returned to In Progress and the hold context was cleared.',
          createdBy: userIds.serviceDesk,
          createdAt: '2026-07-15T12:00:00.000Z',
        },
        {
          id: 'journal-3',
          type: 'action',
          message:
            'Incident resolved by operator. Resolution summary captured: Synthetic resolution notes confirm restored payment processing.',
          createdBy: userIds.serviceDesk,
          createdAt: '2026-07-15T12:00:00.000Z',
        },
      ],
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/incidents/:incidentId/journal',
        httpStatus: 200,
        durationMs: 1,
        correlationId: 'read_journal',
      },
    };
  }

  async holdIncident() {
    this.incident = { ...this.incident, status: 'on_hold' };
    return this.readIncident();
  }

  async resumeIncident() {
    this.incident = { ...this.incident, status: 'in_progress' };
    return this.readIncident();
  }

  async resolveIncident() {
    this.incident = { ...this.incident, status: 'resolved' };
    return this.readIncident();
  }

  async closeIncident() {
    this.closeCalled = true;
    this.incident = { ...this.incident, status: 'closed' };
    return this.readIncident();
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

function buildCore(
  adapter: StatefulIncidentAdapter,
  environment = liveEnvironment,
  stateHooks: LiveStatePersistenceHooks = {},
  backgroundCoordinator?: (operation: () => Promise<void>) => void,
  bundleHooks: BundlePersistenceHooks = {},
  currentFixture: NilesIncidentFixtureV1 = fixture,
  stateRepository?: LiveRunStateRepository,
) {
  const scenarios: ScenarioRepository = new FilesystemScenarioRepository(
    path.join(repositoryRoot, 'scenarios'),
  );
  return new NvsCore(
    new StaticEnvironmentRepository([environment]),
    scenarios,
    new FilesystemRunBundleRepository(temporaryRoot, bundleHooks),
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
      fixtures: new StaticFixtureRepository(currentFixture),
      incidentAdapter: adapter,
      state: stateRepository ?? new FilesystemLiveRunStateRepository(temporaryRoot, stateHooks),
      mutationsEnabled: () => true,
      clock: () => '2026-07-15T12:00:00.000Z',
      correlationIdFactory: (seed) => `live_${seed.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      slaObservationTimeoutMs: 25,
      slaObservationIntervalMs: 1,
      sleep: async (milliseconds) => {
        if (milliseconds > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
        }
      },
      ...(backgroundCoordinator ? { backgroundCoordinator } : {}),
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

  it('checks live readiness without actor login or fixture resource network calls', async () => {
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter);

    const readiness = await core.executionReadiness({
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
    });

    expect(readiness.verdict).toBe('PASS');
    expect(readiness.staticEligible).toBe(true);
    expect(readiness.confirmed).toBe(false);
    expect(readiness.mutationEligible).toBe(false);
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'actor-authentication', status: 'NOT_CHECKED' }),
        expect.objectContaining({ id: 'fixture-resources', status: 'NOT_CHECKED' }),
      ]),
    );
    expect(adapter.operations).toEqual([]);
  });

  it('confirms live readiness with read-only actor and fixture checks', async () => {
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter);

    const readiness = await core.confirmExecutionReadiness({
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
    });

    expect(readiness).toMatchObject({
      verdict: 'PASS',
      confirmed: true,
      staticEligible: true,
      mutationEligible: true,
    });
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'actor-authentication', status: 'PASS' }),
        expect.objectContaining({ id: 'fixture-resources', status: 'PASS' }),
      ]),
    );
    expect(adapter.operations.every((operation) => operation.startsWith('GET'))).toBe(true);
  });

  it('blocks a live run before mutation when a required fixture resource is missing', async () => {
    class MissingResourceAdapter extends StatefulIncidentAdapter {
      override async verifyResource(input: { id: string }) {
        if (input.id === fixture.resources.service.id) {
          throw new LiveRunBlockedError(
            'NILES_FIXTURE_RESOURCE_MISSING',
            'The configured service fixture could not be verified.',
            'ENVIRONMENT',
          );
        }
        return super.verifyResource(input);
      }
    }
    const adapter = new MissingResourceAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-missing-fixture-resource',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('NILES_FIXTURE_RESOURCE_MISSING');
    expect(run.cleanup.status).toBe('NOT_REQUIRED');
    expect(run.resourceInventory.incident).toBeUndefined();
    expect(adapter.operations.some((operation) => operation.startsWith('POST'))).toBe(false);
  });

  it('blocks a live run before mutation when offering compatibility cannot be verified', async () => {
    class MissingOfferingServiceAdapter extends StatefulIncidentAdapter {
      override async verifyResource(input: { id: string }) {
        const resource = await super.verifyResource(input);
        if (input.id === fixture.resources.offering?.id) {
          return { id: resource.id, transport: resource.transport };
        }
        return resource;
      }
    }
    const adapter = new MissingOfferingServiceAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-offering-service-unverified',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('NILES_OFFERING_SERVICE_UNVERIFIED');
    expect(run.cleanup.status).toBe('NOT_REQUIRED');
    expect(adapter.operations.some((operation) => operation.startsWith('POST'))).toBe(false);
  });

  it('blocks a live run before mutation when required actor authentication fails', async () => {
    class DenyingAuthenticator extends FakeAuthenticator {
      override async authenticate(input: {
        profile: ActorProfileV1;
        correlationId: string;
      }): Promise<FakeSession> {
        void input;
        throw new AuthenticationBlockedError(
          'LOGIN_DENIED',
          'NILES denied the actor login.',
          false,
        );
      }
    }
    const adapter = new StatefulIncidentAdapter();
    const scenarios: ScenarioRepository = new FilesystemScenarioRepository(
      path.join(repositoryRoot, 'scenarios'),
    );
    const core = new NvsCore(
      new StaticEnvironmentRepository([liveEnvironment]),
      scenarios,
      new FilesystemRunBundleRepository(temporaryRoot),
      {
        probe: async () => ({
          environmentId: 'live-test',
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
        authenticator: new DenyingAuthenticator(),
      },
      {
        fixtures: new StaticFixtureRepository(fixture),
        incidentAdapter: adapter,
        state: new FilesystemLiveRunStateRepository(temporaryRoot),
        mutationsEnabled: () => true,
      },
    );

    const run = await core.createLiveApiRun({
      runId: 'live-auth-denied',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('LOGIN_DENIED');
    expect(run.cleanup.status).toBe('NOT_REQUIRED');
    expect(run.resourceInventory.incident).toBeUndefined();
    expect(adapter.operations.some((operation) => operation.startsWith('POST'))).toBe(false);
  });

  it('blocks a live run before mutation when a required actor credential is invalid', async () => {
    class InvalidSecrets extends StaticSecrets {
      override async configurationStatus() {
        return 'INVALID' as const;
      }

      override async resolve(): Promise<AuthenticationCredential> {
        throw new Error('resolve should not be called for invalid credential configuration');
      }
    }
    const adapter = new StatefulIncidentAdapter();
    const scenarios: ScenarioRepository = new FilesystemScenarioRepository(
      path.join(repositoryRoot, 'scenarios'),
    );
    const core = new NvsCore(
      new StaticEnvironmentRepository([liveEnvironment]),
      scenarios,
      new FilesystemRunBundleRepository(temporaryRoot),
      {
        probe: async () => ({
          environmentId: 'live-test',
          verdict: 'PASS',
          health: { available: true },
          readiness: { available: false },
          openApi: { available: false },
          version: { available: false, source: 'NONE' },
        }),
      },
      {
        profiles: new StaticActorRepository(),
        secrets: new InvalidSecrets(),
        authenticator: new FakeAuthenticator(),
      },
      {
        fixtures: new StaticFixtureRepository(fixture),
        incidentAdapter: adapter,
        state: new FilesystemLiveRunStateRepository(temporaryRoot),
        mutationsEnabled: () => true,
      },
    );

    const run = await core.createLiveApiRun({
      runId: 'live-invalid-credential',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('CREDENTIAL_INVALID');
    expect(adapter.operations.some((operation) => operation.startsWith('POST'))).toBe(false);
  });

  it('blocks mutation-disabled live runs before actor credential resolution or adapter calls', async () => {
    const adapter = new StatefulIncidentAdapter();
    const authenticate = vi.fn(async () => {
      throw new Error('authentication must not be attempted while mutations are disabled');
    });
    const core = new NvsCore(
      new StaticEnvironmentRepository([liveEnvironment]),
      new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
      new FilesystemRunBundleRepository(temporaryRoot),
      {
        probe: async () => ({
          environmentId: 'live-test',
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
        authenticator: { authenticate },
      },
      {
        fixtures: new StaticFixtureRepository(fixture),
        incidentAdapter: adapter,
        state: new FilesystemLiveRunStateRepository(temporaryRoot),
        mutationsEnabled: () => false,
      },
    );

    await expect(
      core.startLiveApiRun({
        runId: 'live-mutations-disabled',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'NILES_MUTATIONS_DISABLED' });
    expect(authenticate).not.toHaveBeenCalled();
    expect(adapter.operations).toEqual([]);
  });

  it('accepts live runs asynchronously, exposes RUNNING progress, and rejects a concurrent run', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, (operation) => scheduled.push(operation));

    const accepted = await core.startLiveApiRun({
      runId: 'live-async-run',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(accepted).toEqual({
      schemaVersion: 'nvs.live-run-accepted/v1',
      runId: 'live-async-run',
      status: 'ACCEPTED',
    });
    await expect(
      core.startLiveApiRun({
        runId: 'live-second-run',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'LIVE_RUN_IN_PROGRESS' });

    const preparedProgress = await core.getRunProgress('live-async-run');
    expect(preparedProgress.status).toBe('PREPARED');
    expect(preparedProgress.observations).toEqual([]);

    await scheduled[0]!();
    const finalRun = await core.waitForLiveRun('live-async-run');
    expect(finalRun.status).toBe('COMPLETED');
    expect((await core.getRunProgress('live-async-run')).status).toBe('COMPLETED');
  });

  it('reserves live run IDs against later compile-only runs before execution starts', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, (operation) => scheduled.push(operation));

    await core.startLiveApiRun({
      runId: 'shared-live-compile-run',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(scheduled).toHaveLength(1);
    expect(adapter.operations).toEqual([]);
    await expect(
      core.createCompileOnlyRun({
        runId: 'shared-live-compile-run',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        now: '2026-07-15T12:01:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'RUN_ID_ALREADY_EXISTS' });
    expect(adapter.operations).toEqual([]);
  });

  it('releases live run reservations when initial live-state persistence fails before mutation', async () => {
    class FailingReserveStateRepository implements LiveRunStateRepository {
      async reserve(): Promise<void> {
        throw new Error('injected live-state reserve failure');
      }

      async save(): Promise<void> {
        throw new Error('save should not be reached');
      }

      async get(): Promise<LiveRunState | undefined> {
        return undefined;
      }

      async listActive(): Promise<LiveRunState[]> {
        return [];
      }

      async complete(): Promise<void> {}
    }

    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(
      adapter,
      liveEnvironment,
      {},
      undefined,
      {},
      fixture,
      new FailingReserveStateRepository(),
    );

    await expect(
      core.startLiveApiRun({
        runId: 'live-state-reserve-rollback',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toThrow('injected live-state reserve failure');
    expect(adapter.operations).toEqual([]);

    await expect(
      core.createCompileOnlyRun({
        runId: 'live-state-reserve-rollback',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        now: '2026-07-15T12:01:00.000Z',
      }),
    ).resolves.toMatchObject({ runId: 'live-state-reserve-rollback', verdict: 'PASS' });
  });

  it('allows only one compile/live run with the same ID to reserve the namespace', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, (operation) => scheduled.push(operation));

    const attempts = await Promise.allSettled([
      core.createCompileOnlyRun({
        runId: 'same-id-compile-live-race',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        now: '2026-07-15T12:00:00.000Z',
      }),
      core.startLiveApiRun({
        runId: 'same-id-compile-live-race',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(adapter.operations).toEqual([]);
    expect(scheduled.length).toBeLessThanOrEqual(1);
  });

  it('accepts only one of two truly simultaneous live run starts', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const core = buildCore(new StatefulIncidentAdapter(), liveEnvironment, {}, (operation) =>
      scheduled.push(operation),
    );

    const attempts = await Promise.allSettled([
      core.startLiveApiRun({
        runId: 'live-simultaneous-a',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
      core.startLiveApiRun({
        runId: 'live-simultaneous-b',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'LIVE_RUN_IN_PROGRESS' }),
    });
    expect(scheduled).toHaveLength(1);
  });

  it('rejects duplicate live run IDs before actor login or NILES adapter calls', async () => {
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter);
    const first = await core.createLiveApiRun({
      runId: 'live-duplicate-run-id',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });
    expect(first.status).toBe('COMPLETED');

    adapter.operations = [];
    await expect(
      core.createLiveApiRun({
        runId: 'live-duplicate-run-id',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:01:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'RUN_ID_ALREADY_EXISTS' });
    expect(adapter.operations).toEqual([]);
  });

  it('keeps run-owned incident inventory discoverable after a create-time persistence failure', async () => {
    const adapter = new StatefulIncidentAdapter();
    const hooks: LiveStatePersistenceHooks = {
      afterWrite(document, state) {
        if (document === 'inventory.json' && state.resourceInventory.incident) {
          throw new Error('injected crash after create inventory');
        }
      },
    };
    const core = buildCore(adapter, liveEnvironment, hooks);

    await expect(
      core.createLiveApiRun({
        runId: 'live-crash-after-create',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toThrow('injected crash after create inventory');

    const recovered = await new FilesystemLiveRunStateRepository(temporaryRoot).get(
      'live-crash-after-create',
    );
    expect(recovered?.checkpoint.status).toBe('RUNNING');
    expect(recovered?.resourceInventory.incident).toMatchObject({
      id: adapter.incident.id,
      number: adapter.incident.number,
    });
    await expect(
      new FilesystemRunBundleRepository(temporaryRoot).get('live-crash-after-create'),
    ).resolves.toBeUndefined();
  });

  it('keeps ambiguous incident create outcomes recovery-required without claiming no incident exists', async () => {
    class AmbiguousCreateError extends Error {
      readonly code = 'NILES_NETWORK_FAILURE';
      readonly category = 'ADAPTER';
      readonly retryable = true;
      readonly transport = {
        method: 'POST' as const,
        pathTemplate: '/grc/itsm/incidents',
        durationMs: 13,
        correlationId: 'create_response_lost',
      };
    }

    class AmbiguousCreateAdapter extends StatefulIncidentAdapter {
      serverSideCreateSideEffect = false;

      override async createIncident(): Promise<NilesIncidentRecord> {
        this.operations.push('POST create incident');
        this.serverSideCreateSideEffect = true;
        throw new AmbiguousCreateError('client response lost after create side effect');
      }
    }

    const adapter = new AmbiguousCreateAdapter();
    const core = buildCore(adapter);

    await expect(
      core.createLiveApiRun({
        runId: 'live-ambiguous-create',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'NILES_CREATE_OUTCOME_UNKNOWN' });

    expect(adapter.serverSideCreateSideEffect).toBe(true);
    expect(adapter.deleted).toBe(false);
    expect(adapter.operations).toEqual(
      expect.arrayContaining([
        'GET resource 55555555-5555-4555-8555-555555555555',
        'GET resource 66666666-6666-4666-8666-666666666666',
        'POST create incident',
      ]),
    );
    await expect(
      new FilesystemRunBundleRepository(temporaryRoot).get('live-ambiguous-create'),
    ).resolves.toBeUndefined();

    const progress = await core.getRunProgress('live-ambiguous-create');
    expect(progress).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      verdict: 'BLOCKED',
      checkpoint: {
        status: 'RECOVERY_REQUIRED',
        error: { code: 'NILES_CREATE_OUTCOME_UNKNOWN' },
      },
    });
    expect(progress.observations.at(-1)).toMatchObject({
      sourceStepId: 'report-degradation',
      status: 'BLOCKED',
      error: { code: 'NILES_CREATE_OUTCOME_UNKNOWN' },
      evidence: {
        method: 'POST',
        pathTemplate: '/grc/itsm/incidents',
        creationOutcome: 'UNKNOWN',
        marker: 'nvs-m1-02b-live-ambiguous-create',
        createCorrelationId: 'live_live_ambiguous_create_1_incident_report',
      },
    });

    await expect(core.getResourceInventory('live-ambiguous-create')).resolves.toMatchObject({
      creationOutcome: {
        kind: 'INCIDENT_CREATE',
        status: 'UNKNOWN',
        runId: 'live-ambiguous-create',
        runNamespacePrefix: 'nvs-m1-02b',
        marker: 'nvs-m1-02b-live-ambiguous-create',
        tenantId,
        correlationId: 'live_live_ambiguous_create_1_incident_report',
        transport: {
          method: 'POST',
          pathTemplate: '/grc/itsm/incidents',
          correlationId: 'create_response_lost',
        },
      },
    });
    await expect(
      core.executionReadiness({
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
      }),
    ).resolves.toMatchObject({
      verdict: 'BLOCKED',
      error: { code: 'LIVE_RUN_REQUIRES_RECOVERY' },
    });
  });

  it('keeps observations discoverable after an intermediate-step persistence failure', async () => {
    const adapter = new StatefulIncidentAdapter();
    const hooks: LiveStatePersistenceHooks = {
      afterWrite(document, state) {
        if (document === 'observations.json' && state.observations.length >= 3) {
          throw new Error('injected crash after intermediate step');
        }
      },
    };
    const core = buildCore(adapter, liveEnvironment, hooks);

    await expect(
      core.createLiveApiRun({
        runId: 'live-crash-mid-step',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toThrow('injected crash after intermediate step');

    const recovered = await new FilesystemLiveRunStateRepository(temporaryRoot).get(
      'live-crash-mid-step',
    );
    expect(recovered?.checkpoint.status).toBe('RUNNING');
    expect(recovered?.observations.length).toBeGreaterThanOrEqual(3);
    expect(recovered?.resourceInventory.incident?.id).toBe(adapter.incident.id);
  });

  it('leaves finalizing in-flight state recovery-required when final bundle commit fails', async () => {
    const adapter = new StatefulIncidentAdapter();
    const bundleHooks: BundlePersistenceHooks = {
      beforePromote(document) {
        if (document === '.committed') {
          throw new Error('injected commit marker promotion failure');
        }
      },
    };
    const core = buildCore(adapter, liveEnvironment, {}, undefined, bundleHooks);

    await expect(
      core.createLiveApiRun({
        runId: 'live-finalization-failure',
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmRealMutation: true,
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toThrow('injected commit marker promotion failure');

    const recovered = await new FilesystemLiveRunStateRepository(temporaryRoot).get(
      'live-finalization-failure',
    );
    expect(recovered?.checkpoint.status).toBe('FINALIZING');
    await expect(
      new FilesystemRunBundleRepository(temporaryRoot).get('live-finalization-failure'),
    ).resolves.toBeUndefined();
    await expect(core.getRunProgress('live-finalization-failure')).resolves.toMatchObject({
      status: 'RECOVERY_REQUIRED',
      verdict: 'BLOCKED',
      checkpoint: { status: 'RECOVERY_REQUIRED' },
    });
    await expect(
      core.executionReadiness({
        environmentId: 'live-test',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
      }),
    ).resolves.toMatchObject({
      verdict: 'BLOCKED',
      error: { code: 'LIVE_RUN_REQUIRES_RECOVERY' },
    });
  });

  it('finalizes a PASS run when optional SLA evidence is not observed', async () => {
    class NoSlaAdapter extends StatefulIncidentAdapter {
      override async readSlaSummary() {
        return {
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'read_sla_empty',
          },
          records: [],
        };
      }
    }
    const optionalFixture: NilesIncidentFixtureV1 = {
      ...fixture,
      resources: {
        ...fixture.resources,
        closeAuthority: {
          ...fixture.resources.closeAuthority,
          requesterMustHaveIncidentWrite: true,
        },
        sla: { ...fixture.resources.sla, required: false },
      },
    };
    const core = buildCore(new NoSlaAdapter(), liveEnvironment, {}, undefined, {}, optionalFixture);

    const run = await core.createLiveApiRun({
      runId: 'live-optional-sla-not-observed',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('PASS');
    expect(run.stepResults.filter((step) => step.executionStatus === 'NOT_OBSERVED')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ required: false }),
        expect.objectContaining({ required: false }),
      ]),
    );
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.filter((observation) => observation.status === 'NOT_OBSERVED'),
    ).toHaveLength(2);
  });

  it('passes required SLA objectives from a real GRC wrapped array envelope', async () => {
    class WrappedSlaArrayAdapter extends StatefulIncidentAdapter {
      private resumed = false;

      override async resumeIncident() {
        this.resumed = true;
        return super.resumeIncident();
      }

      override async readSlaSummary(): Promise<NilesSlaSummary> {
        this.operations.push('GET SLA summary');
        const status =
          this.incident.status === 'on_hold'
            ? 'PAUSED'
            : this.incident.status === 'resolved' || this.incident.status === 'closed'
              ? 'COMPLETED'
              : 'IN_PROGRESS';
        const payload = {
          success: true,
          data: [
            {
              id: 'sla-response',
              objectiveType: 'response',
              status,
              policyRef: fixture.resources.sla.policyRef,
            },
            {
              id: 'sla-resolution',
              objectiveType: 'resolution',
              status,
              policyRef: fixture.resources.sla.policyRef,
              ...(status === 'PAUSED' ? { pauseAt: '2026-07-15T12:00:00.000Z' } : {}),
              ...(status === 'IN_PROGRESS' && this.resumed
                ? { pauseAt: null, pausedDurationSeconds: 5 }
                : {}),
              ...(status === 'COMPLETED' ? { stopAt: '2026-07-15T12:00:00.000Z' } : {}),
            },
          ],
        };
        const parser = new NilesIncidentApiAdapter(
          vi
            .fn<FetchImplementation>()
            .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })),
          100,
        );
        return parser.readSlaSummary({
          environment: liveEnvironment,
          session: new FakeSession(
            'live-service-desk-agent',
            userIds.serviceDesk,
            tenantId,
            'wrapped-sla',
          ),
          tenantId,
          incidentId: this.incident.id,
          correlationId: 'read_wrapped_sla',
        });
      }
    }
    const closableFixture: NilesIncidentFixtureV1 = {
      ...fixture,
      resources: {
        ...fixture.resources,
        closeAuthority: {
          strategy: 'REQUESTER_CONFIRMATION',
          requesterMustHaveIncidentWrite: true,
        },
      },
    };
    const adapter = new WrappedSlaArrayAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, undefined, {}, closableFixture);

    const run = await core.createLiveApiRun({
      runId: 'live-wrapped-sla-array',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('PASS');
    expect(run.error?.code).not.toBe('SLA_SUMMARY_MISSING');
    const progress = await core.getRunProgress(run.runId);
    const slaObservations = progress.observations.filter((observation) =>
      [
        'observe-active-sla',
        'observe-held-sla',
        'resume-restoration',
        'resolve-with-evidence',
      ].includes(observation.sourceStepId),
    );
    expect(slaObservations).not.toHaveLength(0);
    expect(slaObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'PASS',
          evidence: expect.objectContaining({
            responseObjectiveObserved: true,
            resolutionObjectiveObserved: true,
          }),
        }),
      ]),
    );
  });

  it('blocks required SLA when only the response objective is observable', async () => {
    class ResponseOnlySlaAdapter extends StatefulIncidentAdapter {
      override async readSlaSummary() {
        return {
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'read_sla_response_only',
          },
          records: [{ id: 'sla-1', objectiveType: 'response', status: 'running' }],
        };
      }
    }
    const adapter = new ResponseOnlySlaAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-sla-missing-resolution',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('SLA_SUMMARY_MISSING');
    expect(run.cleanup).toMatchObject({ status: 'CLEAN', policy: 'DELETE_IF_RUN_OWNED' });
    expect(run.resourceInventory.incident?.disposition).toBe('DELETED');
    expect(adapter.deleted).toBe(true);
    expect(adapter.closeCalled).toBe(false);
    const progress = await core.getRunProgress(run.runId);
    const observation = progress.observations.find(
      (candidate) => candidate.error?.code === 'SLA_SUMMARY_MISSING',
    );
    expect(observation?.evidence).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
      responseObjectiveObserved: true,
      resolutionObjectiveObserved: false,
    });
  });

  it('records sanitized transport evidence for a failed multi-call step', async () => {
    class TransportBackedError extends Error {
      readonly code = 'NILES_UPSTREAM_FAILURE';
      readonly category = 'ADAPTER';
      readonly retryable = true;
      readonly transport = {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
        httpStatus: 502,
        durationMs: 7,
        correlationId: 'list_affected_cis_failed',
      };
    }
    class FailingAffectedCiReadAdapter extends StatefulIncidentAdapter {
      override async listAffectedCis(): Promise<NilesAffectedCiSummary> {
        this.operations.push('GET affected CIs');
        throw new TransportBackedError('upstream failure');
      }
    }
    const adapter = new FailingAffectedCiReadAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-failed-transport-evidence',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('NILES_UPSTREAM_FAILURE');
    const progress = await core.getRunProgress(run.runId);
    const observation = progress.observations.find(
      (candidate) => candidate.sourceStepId === 'link-service-context',
    );
    expect(observation?.evidence).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
      httpStatus: 502,
      operations: [
        expect.objectContaining({
          method: 'POST',
          pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
        }),
        expect.objectContaining({
          method: 'GET',
          pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
          httpStatus: 502,
        }),
      ],
    });
    expect(JSON.stringify(observation?.evidence)).not.toMatch(/authorization|dummy|token/i);
  });

  it('preserves HTTP evidence when priority assertion fails after a successful read', async () => {
    class PriorityMismatchAdapter extends StatefulIncidentAdapter {
      override async readIncident() {
        const incident = await super.readIncident();
        return { ...incident, priority: 'p2' as const };
      }
    }
    const core = buildCore(new PriorityMismatchAdapter());

    const run = await core.createLiveApiRun({
      runId: 'live-priority-evidence',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('INCIDENT_PRIORITY_MISMATCH');
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.error?.code === 'INCIDENT_PRIORITY_MISMATCH',
      )?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/incidents/:incidentId',
      observedPriority: 'p2',
      expectedPriority: 'p1',
    });
  });

  it('preserves HTTP evidence when assignment assertion fails after a successful write', async () => {
    const unexpectedGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    class AssignmentMismatchAdapter extends StatefulIncidentAdapter {
      override async assignIncident() {
        this.incident = { ...this.incident, assignmentGroupId: unexpectedGroupId };
        return this.readIncident();
      }
    }
    const core = buildCore(new AssignmentMismatchAdapter());

    const run = await core.createLiveApiRun({
      runId: 'live-assignment-evidence',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('INCIDENT_ASSIGNMENT_GROUP_MISMATCH');
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.error?.code === 'INCIDENT_ASSIGNMENT_GROUP_MISMATCH',
      )?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/incidents/:incidentId',
      assignmentGroupId: unexpectedGroupId,
      expectedAssignmentGroupId: assignmentGroupId,
    });
  });

  it('preserves POST and GET evidence when affected-CI read-back assertion fails', async () => {
    class AffectedCiReadbackMismatchAdapter extends StatefulIncidentAdapter {
      override async listAffectedCis(): Promise<NilesAffectedCiSummary> {
        this.operations.push('GET affected CIs');
        return {
          items: [],
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'list_affected_cis_empty',
          },
        };
      }
    }
    const core = buildCore(new AffectedCiReadbackMismatchAdapter());

    const run = await core.createLiveApiRun({
      runId: 'live-affected-ci-evidence',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('AFFECTED_CI_LINK_NOT_OBSERVED');
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.error?.code === 'AFFECTED_CI_LINK_NOT_OBSERVED',
      )?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
      affectedCiCount: 0,
      operations: [
        expect.objectContaining({ method: 'POST' }),
        expect.objectContaining({ method: 'GET' }),
      ],
    });
  });

  it('blocks required SLA when resume read returns no records', async () => {
    class EmptyResumeSlaAdapter extends StatefulIncidentAdapter {
      private resumed = false;

      override async resumeIncident() {
        this.resumed = true;
        return super.resumeIncident();
      }

      override async readSlaSummary() {
        if (this.resumed) {
          return {
            transport: {
              method: 'GET' as const,
              pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
              httpStatus: 200,
              durationMs: 1,
              correlationId: 'read_sla_empty_resume',
            },
            records: [],
          };
        }
        return super.readSlaSummary();
      }
    }
    const adapter = new EmptyResumeSlaAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-empty-resume-sla',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('SLA_SUMMARY_MISSING');
    expect(run.cleanup).toMatchObject({ status: 'CLEAN', policy: 'DELETE_IF_RUN_OWNED' });
    expect(adapter.deleted).toBe(true);
  });

  it('accepts resumed SLA records with historical paused duration after current pause clears', async () => {
    class HistoricalPauseAfterResumeAdapter extends StatefulIncidentAdapter {
      private resumed = false;

      override async resumeIncident() {
        this.resumed = true;
        return super.resumeIncident();
      }

      override async readSlaSummary(): Promise<NilesSlaSummary> {
        if (this.resumed && this.incident.status === 'in_progress') {
          const policyEvidence = fixture.resources.sla.policyRef
            ? { policyRef: fixture.resources.sla.policyRef }
            : {};
          return {
            transport: {
              method: 'GET' as const,
              pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
              httpStatus: 200,
              durationMs: 1,
              correlationId: 'read_sla_resumed_history',
            },
            records: [
              {
                id: 'sla-1',
                objectiveType: 'response',
                status: 'IN_PROGRESS',
                ...policyEvidence,
              },
              {
                id: 'sla-2',
                objectiveType: 'resolution',
                status: 'IN_PROGRESS',
                pausedDurationSeconds: 5,
                ...policyEvidence,
              },
            ],
          };
        }
        return super.readSlaSummary();
      }
    }
    const closableFixture: NilesIncidentFixtureV1 = {
      ...fixture,
      resources: {
        ...fixture.resources,
        closeAuthority: {
          strategy: 'REQUESTER_CONFIRMATION',
          requesterMustHaveIncidentWrite: true,
        },
      },
    };
    const adapter = new HistoricalPauseAfterResumeAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, undefined, {}, closableFixture);

    const run = await core.createLiveApiRun({
      runId: 'live-resumed-sla-history',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('PASS');
    expect(run.error?.code).not.toBe('SLA_NOT_RESUMED');
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.sourceStepId === 'resume-restoration',
      ),
    ).toMatchObject({
      status: 'PASS',
      evidence: {
        slaPauseHistoryObserved: true,
        responseObjectiveObserved: true,
        resolutionObjectiveObserved: true,
      },
    });
  });

  it('fails resumed SLA records when current pause posture remains set', async () => {
    class StillPausedAfterResumeAdapter extends StatefulIncidentAdapter {
      private resumed = false;

      override async resumeIncident() {
        this.resumed = true;
        return super.resumeIncident();
      }

      override async readSlaSummary(): Promise<NilesSlaSummary> {
        if (this.resumed && this.incident.status === 'in_progress') {
          const policyEvidence = fixture.resources.sla.policyRef
            ? { policyRef: fixture.resources.sla.policyRef }
            : {};
          return {
            transport: {
              method: 'GET' as const,
              pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
              httpStatus: 200,
              durationMs: 1,
              correlationId: 'read_sla_still_paused',
            },
            records: [
              {
                id: 'sla-1',
                objectiveType: 'response',
                status: 'PAUSED',
                ...policyEvidence,
              },
              {
                id: 'sla-2',
                objectiveType: 'resolution',
                status: 'IN_PROGRESS',
                pauseAt: '2026-07-15T12:00:00.000Z',
                pausedDurationSeconds: 5,
                ...policyEvidence,
              },
            ],
          };
        }
        return super.readSlaSummary();
      }
    }
    const adapter = new StillPausedAfterResumeAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-sla-still-paused-after-resume',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('SLA_NOT_RESUMED');
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find((observation) => observation.error?.code === 'SLA_NOT_RESUMED')
        ?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
      slaPauseHistoryObserved: true,
    });
  });

  it('fails required SLA when active records are cancelled instead of running', async () => {
    class CancelledSlaAdapter extends StatefulIncidentAdapter {
      override async readSlaSummary() {
        const policyEvidence = fixture.resources.sla.policyRef
          ? { policyRef: fixture.resources.sla.policyRef }
          : {};
        return {
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'read_sla_cancelled',
          },
          records: [
            {
              id: 'sla-1',
              objectiveType: 'response',
              status: 'cancelled',
              ...policyEvidence,
            },
            {
              id: 'sla-2',
              objectiveType: 'resolution',
              status: 'cancelled',
              ...policyEvidence,
            },
          ],
        };
      }
    }
    const adapter = new CancelledSlaAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-cancelled-sla',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('SLA_ACTIVE_POSTURE_NOT_OBSERVED');
    expect(run.cleanup).toMatchObject({
      status: 'RETAINED_BY_POLICY',
      policy: 'RETAIN_FOR_DIAGNOSIS',
    });
    expect(adapter.deleted).toBe(false);
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.error?.code === 'SLA_ACTIVE_POSTURE_NOT_OBSERVED',
      )?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
      responseObjectiveObserved: true,
      resolutionObjectiveObserved: true,
    });
  });

  it('fails required SLA when observed records reference the wrong policy', async () => {
    class WrongPolicySlaAdapter extends StatefulIncidentAdapter {
      override async readSlaSummary() {
        const summary = await super.readSlaSummary();
        return {
          ...summary,
          records: summary.records.map((record) => ({ ...record, policyRef: 'wrong-policy' })),
        };
      }
    }
    const adapter = new WrongPolicySlaAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-wrong-sla-policy',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('SLA_POLICY_MISMATCH');
    expect(run.cleanup).toMatchObject({
      status: 'RETAINED_BY_POLICY',
      policy: 'RETAIN_FOR_DIAGNOSIS',
    });
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find((observation) => observation.error?.code === 'SLA_POLICY_MISMATCH')
        ?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
      responseObjectiveObserved: true,
      resolutionObjectiveObserved: true,
    });
  });

  it('blocks required SLA when held posture is not observable', async () => {
    class MissingPauseSlaAdapter extends StatefulIncidentAdapter {
      override async readSlaSummary() {
        return {
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'read_sla_no_pause',
          },
          records: [
            { id: 'sla-1', objectiveType: 'response', status: 'running' },
            { id: 'sla-2', objectiveType: 'resolution', status: 'running' },
          ],
        };
      }
    }
    const adapter = new MissingPauseSlaAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-sla-pause-missing',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('SLA_PAUSE_NOT_OBSERVED');
    expect(adapter.closeCalled).toBe(false);
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.error?.code === 'SLA_PAUSE_NOT_OBSERVED',
      )?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
      slaPhase: 'held',
    });
  });

  it('blocks audit review when journal entries are not observable', async () => {
    class EmptyJournalAdapter extends StatefulIncidentAdapter {
      override async readJournalSummary() {
        return {
          count: 0,
          entries: [],
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/incidents/:incidentId/journal',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'read_empty_journal',
          },
        };
      }
    }
    const adapter = new EmptyJournalAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-empty-audit-journal',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('AUDIT_JOURNAL_NOT_OBSERVED');
    expect(run.cleanup).toMatchObject({ status: 'CLEAN', policy: 'DELETE_IF_RUN_OWNED' });
    expect(run.resourceInventory.incident?.disposition).toBe('DELETED');
    expect(adapter.deleted).toBe(true);
    expect(adapter.closeCalled).toBe(false);
  });

  it('blocks audit attribution when stable public journal fields are unavailable', async () => {
    class UnstableJournalAdapter extends StatefulIncidentAdapter {
      override async readJournalSummary() {
        return {
          count: 3,
          entries: [
            { id: 'journal-1', type: 'action', createdBy: userIds.serviceDesk },
            { id: 'journal-2', type: 'action', createdBy: userIds.serviceDesk },
            { id: 'journal-3', type: 'action', createdBy: userIds.serviceDesk },
          ],
          transport: {
            method: 'GET' as const,
            pathTemplate: '/grc/itsm/incidents/:incidentId/journal',
            httpStatus: 200,
            durationMs: 1,
            correlationId: 'read_unstable_journal',
          },
        };
      }
    }
    const adapter = new UnstableJournalAdapter();
    const core = buildCore(adapter);

    const run = await core.createLiveApiRun({
      runId: 'live-unstable-audit-journal',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('AUDIT_ACTION_ATTRIBUTION_UNAVAILABLE');
    expect(run.cleanup).toMatchObject({ status: 'CLEAN', policy: 'DELETE_IF_RUN_OWNED' });
    expect(adapter.deleted).toBe(true);
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.error?.code === 'AUDIT_ACTION_ATTRIBUTION_UNAVAILABLE',
      )?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/incidents/:incidentId/journal',
      journalCount: 3,
      operations: [
        expect.objectContaining({ method: 'GET', pathTemplate: '/grc/itsm/incidents/:incidentId' }),
        expect.objectContaining({
          method: 'GET',
          pathTemplate: '/grc/itsm/incidents/:incidentId/journal',
        }),
      ],
    });
  });

  it('preserves HTTP evidence when close state assertion fails after a successful close call', async () => {
    class CloseStateMismatchAdapter extends StatefulIncidentAdapter {
      override async closeIncident() {
        this.closeCalled = true;
        this.incident = { ...this.incident, status: 'resolved' };
        return this.readIncident();
      }
    }
    const closableFixture: NilesIncidentFixtureV1 = {
      ...fixture,
      resources: {
        ...fixture.resources,
        closeAuthority: {
          strategy: 'REQUESTER_CONFIRMATION',
          requesterMustHaveIncidentWrite: true,
        },
      },
    };
    const adapter = new CloseStateMismatchAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, undefined, {}, closableFixture);

    const run = await core.createLiveApiRun({
      runId: 'live-close-state-evidence',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('FAIL');
    expect(run.error?.code).toBe('INCIDENT_NOT_CLOSED');
    expect(adapter.closeCalled).toBe(true);
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find((observation) => observation.error?.code === 'INCIDENT_NOT_CLOSED')
        ?.evidence,
    ).toMatchObject({
      method: 'GET',
      pathTemplate: '/grc/itsm/incidents/:incidentId',
      status: 'resolved',
    });
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
    expect(adapter.operations.indexOf('POST affected CI')).toBeGreaterThan(-1);
    expect(adapter.operations.indexOf('GET affected CIs')).toBeGreaterThan(
      adapter.operations.indexOf('POST affected CI'),
    );
    expect(adapter.closeCalled).toBe(false);
    expect(adapter.deleted).toBe(true);

    const progress = await core.getRunProgress(run.runId);
    const auditObservation = progress.observations.find(
      (observation) => observation.sourceStepId === 'inspect-resolution-audit',
    );
    expect(auditObservation).toMatchObject({
      actorId: 'incident-manager',
      semanticActorId: 'incident-manager',
      actorProfileId: 'live-incident-manager',
      status: 'PASS',
    });
    expect(progress.observations.at(-1)).toMatchObject({
      sourceStepId: 'close-resolved-incident',
      actorId: 'requester',
      semanticActorId: 'requester',
      actorProfileId: 'live-requester',
      status: 'BLOCKED',
      error: { code: 'NILES_CLOSE_AUTHORITY_UNSATISFIABLE' },
    });
    expect(progress.observations.at(-1)?.actorProfileId).not.toBe('live-incident-manager');
    await expect(core.getResourceInventory(run.runId)).resolves.toMatchObject({
      incident: { disposition: 'DELETED' },
    });
    expect(JSON.stringify(await core.getEvidence(run.runId))).not.toMatch(
      /fake-token|actor@example|synthetic-test-value/i,
    );
  });

  it('uses the reviewed legacy assignment label when the tenant has no group records', async () => {
    const legacyFixture: NilesIncidentFixtureV1 = {
      ...fixture,
      resources: {
        ...fixture.resources,
        assignmentGroup: { mode: 'LEGACY_LABEL', label: 'NVS Service Desk' },
      },
    };
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, undefined, {}, legacyFixture);

    const run = await core.createLiveApiRun({
      runId: 'live-legacy-assignment-label',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('NILES_CLOSE_AUTHORITY_UNSATISFIABLE');
    expect(run.resourceInventory.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ASSIGNMENT_LABEL',
          id: 'legacy-label:NVS Service Desk',
          label: 'NVS Service Desk',
        }),
      ]),
    );
    expect(adapter.incident.assignmentGroup).toBe('NVS Service Desk');
    expect(adapter.incident.assignmentGroupId).toBeNull();
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find(
        (observation) => observation.sourceStepId === 'assign-service-desk',
      )?.evidence,
    ).toMatchObject({
      assignmentBindingMode: 'LEGACY_LABEL',
      assignmentGroup: 'NVS Service Desk',
      expectedAssignmentGroup: 'NVS Service Desk',
    });
  });
});
