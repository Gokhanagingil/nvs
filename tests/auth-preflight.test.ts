import { NilesActorSession } from '@nvs/adapter-niles';
import type {
  ActorPersona,
  ActorProfileV1,
  EnvironmentActorMapV1,
  EnvironmentDefinitionV1,
} from '@nvs/contracts';
import {
  AuthenticationBlockedError,
  NvsCore,
  type ActorAuthenticator,
  type ActorProfileRepository,
  type ActorSession,
  type AuthenticationCredential,
  type RunBundleRepository,
  type ScenarioRepository,
} from '@nvs/core';
import {
  EnvironmentVariableSecretProvider,
  credentialEnvironmentVariable,
} from '@nvs/secret-provider-environment';
import { describe, expect, it, vi } from 'vitest';

const primaryTenant = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const personas: ActorPersona[] = [
  'requester',
  'service-desk-agent',
  'incident-manager',
  'tenant-admin',
  'cross-tenant-agent',
];
const personaUserIds: Record<ActorPersona, string> = {
  requester: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'service-desk-agent': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'incident-manager': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'tenant-admin': 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'cross-tenant-agent': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};

function environment(kind: EnvironmentDefinitionV1['kind'] = 'test'): EnvironmentDefinitionV1 {
  return {
    schemaVersion: 'nvs.environment/v1',
    id: 'preflight-test',
    displayName: 'Preflight test',
    baseUrl: 'https://niles.invalid',
    kind,
    healthPath: '/health/live',
    capabilities: { health: true, readiness: false, openApi: false, version: false },
    enabled: true,
  };
}

function actorProfiles(): ActorProfileV1[] {
  return personas.map((persona) => ({
    schemaVersion: 'nvs.actor-profile/v1',
    id: `actor-${persona}`,
    displayName: `Synthetic ${persona}`,
    persona,
    environmentId: 'preflight-test',
    tenantId: persona === 'cross-tenant-agent' ? otherTenant : primaryTenant,
    credentialRef: `niles.preflight.${persona}`,
    expectedDomains: ['itsm'],
    expectedRoles: [persona],
    capabilityNotes: [],
    enabled: true,
    mfa: 'NOT_EXPECTED',
    provenance: { source: 'unit test' },
  }));
}

function profileRepository(profiles: ActorProfileV1[]): ActorProfileRepository {
  const mapping: EnvironmentActorMapV1 = {
    schemaVersion: 'nvs.environment-actor-map/v1',
    environmentId: 'preflight-test',
    actors: {
      requester: 'actor-requester',
      'service-desk-agent': 'actor-service-desk-agent',
      'incident-manager': 'actor-incident-manager',
      'tenant-admin': 'actor-tenant-admin',
      'cross-tenant-agent': 'actor-cross-tenant-agent',
    },
    provenance: { source: 'unit test' },
  };
  return {
    async getForEnvironment() {
      return { mapping, profiles };
    },
  };
}

const scenarios: ScenarioRepository = {
  async list() {
    return [];
  },
  async get() {
    return undefined;
  },
};
const bundles: RunBundleRepository = {
  async saveBundle() {
    throw new Error('not used');
  },
  async list() {
    return [];
  },
  async get() {
    return undefined;
  },
  async getPlan() {
    return undefined;
  },
  async getEvidence() {
    return undefined;
  },
};

function secretSource(profiles: ActorProfileV1[], omittedProfileId?: string) {
  return Object.fromEntries(
    profiles
      .filter((profile) => profile.id !== omittedProfileId)
      .map((profile) => [
        credentialEnvironmentVariable(profile.credentialRef),
        JSON.stringify({
          email: `${profile.persona}@example.invalid`,
          password: 'synthetic-test-value',
        }),
      ]),
  );
}

function buildCore(input: {
  environment?: EnvironmentDefinitionV1;
  profiles?: ActorProfileV1[];
  omittedProfileId?: string;
  authenticator?: ActorAuthenticator;
}) {
  const target = input.environment ?? environment();
  const profiles = input.profiles ?? actorProfiles();
  const sessions: ActorSession[] = [];
  const authenticator: ActorAuthenticator =
    input.authenticator ??
    ({
      async authenticate({ profile, correlationId }) {
        const session = new NilesActorSession(
          profile.id,
          personaUserIds[profile.persona],
          profile.tenantId,
          correlationId,
          `token-${profile.id}`,
        );
        sessions.push(session);
        return session;
      },
    } satisfies ActorAuthenticator);
  let correlationSequence = 0;
  let monotonic = 0;
  const core = new NvsCore(
    {
      async list() {
        return [target];
      },
      async get(id) {
        return id === target.id ? target : undefined;
      },
    },
    scenarios,
    bundles,
    {
      async probe(environmentInput) {
        return {
          environmentId: environmentInput.id,
          verdict: 'PASS',
          health: { available: true, status: 200 },
          readiness: { available: false },
          openApi: { available: false },
          version: { available: false, source: 'NONE' },
        };
      },
    },
    {
      profiles: profileRepository(profiles),
      secrets: new EnvironmentVariableSecretProvider(
        secretSource(profiles, input.omittedProfileId),
      ),
      authenticator,
      clock: () => '2026-07-14T18:00:00.000Z',
      monotonicClock: () => {
        monotonic += 5;
        return monotonic;
      },
      correlationIdFactory: () => {
        correlationSequence += 1;
        return `auth_correlation_${correlationSequence}`;
      },
    },
  );
  return { core, sessions, authenticator };
}

describe('actor authentication preflight', () => {
  it('reports safe configuration status and destroys every independent session after PASS', async () => {
    const { core, sessions } = buildCore({});

    const listing = await core.listActorReadiness('preflight-test');
    expect(listing.gateEligible).toBe(false);
    expect(listing.actors).toHaveLength(5);
    expect(listing.actors.every((actor) => actor.credentialConfiguration === 'CONFIGURED')).toBe(
      true,
    );
    expect(listing.actors.every((actor) => actor.authenticationState === 'NOT_ATTEMPTED')).toBe(
      true,
    );

    const result = await core.runAuthenticationPreflight('preflight-test');
    expect(result).toMatchObject({
      verdict: 'PASS',
      gateEligible: false,
      assuranceScope: 'AUTHENTICATION_READINESS_ONLY',
    });
    expect(result.actors.map((actor) => actor.authenticationState)).toEqual([
      'AUTHENTICATED',
      'AUTHENTICATED',
      'AUTHENTICATED',
      'AUTHENTICATED',
      'AUTHENTICATED',
    ]);
    expect(new Set(result.actors.map((actor) => actor.correlationId)).size).toBe(5);
    expect(sessions).toHaveLength(5);
    expect(sessions.every((session) => session.destroyed)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /token-|@example|synthetic-test-value|authorization/i,
    );
  });

  it('surfaces PASSWORD_CHANGE_REQUIRED as BLOCKED and destroys no usable sessions', async () => {
    const authenticator = {
      async authenticate() {
        throw new AuthenticationBlockedError(
          'PASSWORD_CHANGE_REQUIRED',
          'NILES requires a password change before authenticated actor use is allowed.',
          false,
        );
      },
    } satisfies ActorAuthenticator;
    const { core, sessions } = buildCore({ authenticator });

    const result = await core.runAuthenticationPreflight('preflight-test');
    expect(result.verdict).toBe('BLOCKED');
    expect(
      result.actors.every(
        (actor) =>
          actor.authenticationState === 'BLOCKED' &&
          actor.error?.code === 'PASSWORD_CHANGE_REQUIRED',
      ),
    ).toBe(true);
    expect(sessions).toHaveLength(0);
    expect(JSON.stringify(result)).not.toMatch(
      /token-|@example|synthetic-test-value|passwordPolicy|mustChangePassword/i,
    );
  });

  it('blocks production before login and reports missing credentials safely', async () => {
    const productionAuthenticator = {
      authenticate:
        vi.fn<
          (input: {
            environment: EnvironmentDefinitionV1;
            profile: ActorProfileV1;
            credential: AuthenticationCredential;
            correlationId: string;
          }) => Promise<ActorSession>
        >(),
    } satisfies ActorAuthenticator;
    const production = buildCore({
      environment: environment('production'),
      authenticator: productionAuthenticator,
    });
    await expect(
      production.core.runAuthenticationPreflight('preflight-test'),
    ).rejects.toMatchObject({
      code: 'PRODUCTION_AUTH_PREFLIGHT_FORBIDDEN',
      category: 'ENVIRONMENT',
    });
    expect(productionAuthenticator.authenticate).not.toHaveBeenCalled();

    const missing = buildCore({ omittedProfileId: 'actor-incident-manager' });
    const listing = await missing.core.listActorReadiness('preflight-test');
    expect(
      listing.actors.find((actor) => actor.actorProfileId === 'actor-incident-manager'),
    ).toMatchObject({
      credentialConfiguration: 'NOT_CONFIGURED',
      authenticationState: 'NOT_ATTEMPTED',
    });
    const result = await missing.core.runAuthenticationPreflight('preflight-test');
    expect(
      result.actors.find((actor) => actor.actorProfileId === 'actor-incident-manager'),
    ).toMatchObject({
      authenticationState: 'BLOCKED',
      error: { code: 'CREDENTIAL_MISSING' },
    });
  });

  it('blocks tenant mismatch and explicit disabled profiles while clearing sessions', async () => {
    const profiles = actorProfiles();
    profiles[1] = { ...profiles[1]!, enabled: false };
    const sessions: ActorSession[] = [];
    const authenticator: ActorAuthenticator = {
      async authenticate({ profile, correlationId }) {
        const session = new NilesActorSession(
          profile.id,
          `user-${profile.id}`,
          primaryTenant,
          correlationId,
          `token-${profile.id}`,
        );
        sessions.push(session);
        return session;
      },
    };
    const { core } = buildCore({ profiles, authenticator });

    const result = await core.runAuthenticationPreflight('preflight-test');
    expect(result.verdict).toBe('BLOCKED');
    expect(result.actors[1]).toMatchObject({
      credentialConfiguration: 'DISABLED',
      authenticationState: 'DISABLED',
    });
    expect(result.actors[4]).toMatchObject({
      authenticationState: 'BLOCKED',
      expectedTenantId: otherTenant,
      observedTenantId: primaryTenant,
      error: { code: 'TENANT_MISMATCH' },
    });
    expect(sessions.every((session) => session.destroyed)).toBe(true);
  });
});
