import { NilesAuthenticationAdapter, type FetchImplementation } from '@nvs/adapter-niles';
import type { ActorProfileV1, EnvironmentDefinitionV1 } from '@nvs/contracts';
import {
  EnvironmentVariableSecretProvider,
  credentialEnvironmentVariable,
} from '@nvs/secret-provider-environment';
import { describe, expect, it, vi } from 'vitest';

const tenantId = '11111111-1111-4111-8111-111111111111';
const environment: EnvironmentDefinitionV1 = {
  schemaVersion: 'nvs.environment/v1',
  id: 'auth-test',
  displayName: 'Authentication test',
  baseUrl: 'https://niles.invalid',
  kind: 'test',
  healthPath: '/health/live',
  capabilities: { health: true, readiness: false, openApi: false, version: false },
  enabled: true,
};
const profile: ActorProfileV1 = {
  schemaVersion: 'nvs.actor-profile/v1',
  id: 'requester',
  displayName: 'Synthetic requester',
  persona: 'requester',
  environmentId: 'auth-test',
  tenantId,
  credentialRef: 'niles.auth.requester',
  expectedDomains: ['itsm'],
  expectedRoles: ['requester'],
  capabilityNotes: [],
  enabled: true,
  mfa: 'NOT_EXPECTED',
  provenance: { source: 'unit test' },
};

async function credential(reference: string, email: string, password = 'synthetic-test-value') {
  return new EnvironmentVariableSecretProvider({
    [credentialEnvironmentVariable(reference)]: JSON.stringify({ email, password }),
  }).resolve(reference);
}

describe('authenticated NILES adapter', () => {
  it('creates isolated sessions from direct and wrapped login responses', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async (input, init) => {
      expect(String(input)).toBe('https://niles.invalid/auth/login');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { email: string };
      const result = {
        accessToken: body.email.startsWith('requester') ? 'token-requester' : 'token-agent',
        user: {
          id: body.email.startsWith('requester') ? 'user-requester' : 'user-agent',
          tenantId,
        },
      };
      return new Response(
        JSON.stringify(
          body.email.startsWith('requester') ? result : { success: true, data: result },
        ),
        { status: 200 },
      );
    });
    const adapter = new NilesAuthenticationAdapter(fetchMock);
    const requesterCredential = await credential(
      profile.credentialRef,
      'requester@example.invalid',
    );
    const agentProfile: ActorProfileV1 = {
      ...profile,
      id: 'service-desk-agent',
      displayName: 'Synthetic Service Desk agent',
      persona: 'service-desk-agent',
      credentialRef: 'niles.auth.service-desk-agent',
    };
    const agentCredential = await credential(agentProfile.credentialRef, 'agent@example.invalid');

    const requesterSession = await adapter.authenticate({
      environment,
      profile,
      credential: requesterCredential,
      correlationId: 'auth_requester',
    });
    const agentSession = await adapter.authenticate({
      environment,
      profile: agentProfile,
      credential: agentCredential,
      correlationId: 'auth_agent',
    });

    expect(requesterSession).not.toBe(agentSession);
    await expect(requesterSession.withAuthorization(async (value) => value)).resolves.toBe(
      'Bearer token-requester',
    );
    await expect(agentSession.withAuthorization(async (value) => value)).resolves.toBe(
      'Bearer token-agent',
    );
    const serialized = JSON.stringify({ requesterSession, agentSession });
    expect(serialized).not.toMatch(/token-requester|token-agent|synthetic-test-value/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    requesterCredential.destroy();
    agentCredential.destroy();
    requesterSession.destroy();
    agentSession.destroy();
    await expect(
      requesterSession.withAuthorization(async () => 'unexpected'),
    ).rejects.toMatchObject({ code: 'ACTOR_SESSION_DESTROYED' });
  });

  it.each([
    [
      'denied login',
      new Response(JSON.stringify({ message: 'invalid secret detail' }), { status: 401 }),
      'LOGIN_DENIED',
    ],
    [
      'MFA challenge',
      new Response(
        JSON.stringify({ mfaRequired: true, mfaToken: 'confidential-challenge-token' }),
        { status: 200 },
      ),
      'MFA_REQUIRED',
    ],
    [
      'malformed JSON',
      new Response('<html>not-json</html>', { status: 200 }),
      'LOGIN_RESPONSE_MALFORMED',
    ],
    [
      'missing access token',
      new Response(JSON.stringify({ user: { id: 'user-id', tenantId } }), { status: 200 }),
      'ACCESS_TOKEN_MISSING',
    ],
    [
      'missing user identity',
      new Response(JSON.stringify({ accessToken: 'confidential-access-token' }), { status: 200 }),
      'USER_IDENTITY_MISSING',
    ],
  ])('classifies %s as typed BLOCKED behavior', async (_name, response, code) => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(response);
    const actorCredential = await credential(profile.credentialRef, 'actor@example.invalid');

    await expect(
      new NilesAuthenticationAdapter(fetchMock).authenticate({
        environment,
        profile,
        credential: actorCredential,
        correlationId: 'auth_failure',
      }),
    ).rejects.toMatchObject({ code });
    await expect(
      new NilesAuthenticationAdapter(fetchMock)
        .authenticate({
          environment,
          profile,
          credential: actorCredential,
          correlationId: 'auth_failure_repeat',
        })
        .catch((error: unknown) => JSON.stringify(error)),
    ).resolves.not.toMatch(/confidential|synthetic-test-value|actor@example/i);
    actorCredential.destroy();
  });

  it('classifies timeout and network failure without leaking transport details', async () => {
    vi.useFakeTimers();
    try {
      const hangingFetch = vi.fn<FetchImplementation>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('confidential transport detail', 'AbortError')),
              { once: true },
            );
          }),
      );
      const actorCredential = await credential(profile.credentialRef, 'actor@example.invalid');
      const pending = new NilesAuthenticationAdapter(hangingFetch, 100).authenticate({
        environment,
        profile,
        credential: actorCredential,
        correlationId: 'auth_timeout',
      });
      const timeoutExpectation = expect(pending).rejects.toMatchObject({
        code: 'LOGIN_TIMEOUT',
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(100);
      await timeoutExpectation;
      actorCredential.destroy();
    } finally {
      vi.useRealTimers();
    }

    const failingFetch = vi
      .fn<FetchImplementation>()
      .mockRejectedValue(new Error('confidential network detail'));
    const actorCredential = await credential(profile.credentialRef, 'actor@example.invalid');
    await expect(
      new NilesAuthenticationAdapter(failingFetch).authenticate({
        environment,
        profile,
        credential: actorCredential,
        correlationId: 'auth_network',
      }),
    ).rejects.toMatchObject({
      code: 'LOGIN_NETWORK_FAILURE',
      message: 'NILES login could not be reached.',
    });
    actorCredential.destroy();
  });

  it('rejects production before resolving or sending a credential', async () => {
    const fetchMock = vi.fn<FetchImplementation>();
    const actorCredential = await credential(profile.credentialRef, 'actor@example.invalid');

    await expect(
      new NilesAuthenticationAdapter(fetchMock).authenticate({
        environment: { ...environment, kind: 'production' },
        profile,
        credential: actorCredential,
        correlationId: 'auth_production',
      }),
    ).rejects.toMatchObject({ code: 'PRODUCTION_AUTH_PREFLIGHT_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
    actorCredential.destroy();
  });
});
