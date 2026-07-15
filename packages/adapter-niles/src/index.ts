import {
  probeResultV1Schema,
  type ActorProfileV1,
  type EnvironmentDefinitionV1,
  type ProbeResultV1,
} from '@nvs/contracts';
import {
  AuthenticationBlockedError,
  type ActorAuthenticator,
  type ActorSession,
  type AuthenticationCredential,
  type EnvironmentProbe,
  type NilesFixtureResource,
  type NilesIncidentLiveAdapter,
  type NilesIncidentRecord,
  type NilesJournalSummary,
  type NilesSlaSummary,
  type NilesTransportEvidence,
} from '@nvs/core';

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
export const DEFAULT_AUTHENTICATION_TIMEOUT_MS = 5_000;

class ProbeRequestTimeoutError extends Error {
  constructor() {
    super('The probe request exceeded its deadline.');
    this.name = 'ProbeRequestTimeoutError';
  }
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof ProbeRequestTimeoutError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

async function withProbeTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new ProbeRequestTimeoutError());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

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
  timeoutMs: number,
): Promise<ReadinessResult> {
  if (!environment.readinessPath || !environment.capabilities.readiness) {
    return { readiness: { available: false } };
  }

  try {
    const { response, payload } = await withProbeTimeout(timeoutMs, async (signal) => {
      const response = await fetchImplementation(
        new URL(environment.readinessPath!, environment.baseUrl),
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal,
        },
      );
      return {
        response,
        payload: response.ok ? unwrapPayload(await readJson(response)) : undefined,
      };
    });
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
  } catch (error) {
    const timedOut = isTimeout(error);
    return {
      readiness: { available: false },
      error: {
        category: 'ENVIRONMENT',
        code: timedOut ? 'READINESS_TIMEOUT' : 'READINESS_UNREACHABLE',
        message: timedOut
          ? 'Required NILES readiness capability did not respond within the probe deadline.'
          : 'Required NILES readiness capability is unreachable.',
        retryable: true,
      },
    };
  }
}

function isOpenApiDocument(value: unknown): boolean {
  const root = asRecord(value);
  const wrapped = asRecord(root?.['data']);
  return [root, wrapped].some(
    (candidate) =>
      typeof candidate?.['openapi'] === 'string' || typeof candidate?.['swagger'] === 'string',
  );
}

async function optionalOpenApi(
  environment: EnvironmentDefinitionV1,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
): Promise<{ available: boolean; status?: number }> {
  if (!environment.openApiPath || !environment.capabilities.openApi) {
    return { available: false };
  }

  try {
    const { response, payload } = await withProbeTimeout(timeoutMs, async (signal) => {
      const response = await fetchImplementation(
        new URL(environment.openApiPath!, environment.baseUrl),
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal,
        },
      );
      return {
        response,
        payload: response.ok ? await readJson(response) : undefined,
      };
    });
    if (!response.ok) {
      return { available: false, status: response.status };
    }
    return { available: isOpenApiDocument(payload), status: response.status };
  } catch {
    return { available: false };
  }
}

async function optionalVersion(
  environment: EnvironmentDefinitionV1,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
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
    const { response, payload } = await withProbeTimeout(timeoutMs, async (signal) => {
      const response = await fetchImplementation(
        new URL(environment.versionPath!, environment.baseUrl),
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal,
        },
      );
      return {
        response,
        payload: response.ok ? unwrapPayload(await readJson(response)) : undefined,
      };
    });
    if (!response.ok) {
      return { available: false, status: response.status, source: 'NONE' };
    }

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
  constructor(
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new RangeError('Probe timeout must be an integer between 1 and 30000 milliseconds.');
    }
  }

  async probe(environment: EnvironmentDefinitionV1): Promise<ProbeResultV1> {
    let healthResponse: Response;
    try {
      healthResponse = await withProbeTimeout(this.timeoutMs, (signal) =>
        this.fetchImplementation(new URL(environment.healthPath, environment.baseUrl), {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal,
        }),
      );
    } catch (error) {
      const timedOut = isTimeout(error);
      return probeResultV1Schema.parse({
        environmentId: environment.id,
        verdict: 'BLOCKED',
        health: { available: false },
        readiness: { available: false },
        openApi: { available: false },
        version: { available: false, source: 'NONE' },
        error: {
          category: 'ENVIRONMENT',
          code: timedOut ? 'HEALTH_TIMEOUT' : 'HEALTH_UNREACHABLE',
          message: timedOut
            ? 'Required NILES health capability did not respond within the probe deadline.'
            : 'Required NILES health capability is unreachable.',
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

    const readiness = await optionalReadiness(
      environment,
      this.fetchImplementation,
      this.timeoutMs,
    );
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
      optionalOpenApi(environment, this.fetchImplementation, this.timeoutMs),
      optionalVersion(environment, this.fetchImplementation, this.timeoutMs),
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

class AuthenticationRequestTimeoutError extends Error {
  constructor() {
    super('The authentication request exceeded its deadline.');
    this.name = 'AuthenticationRequestTimeoutError';
  }
}

async function withAuthenticationTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new AuthenticationRequestTimeoutError());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrapLoginPayload(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) {
    return undefined;
  }
  if ('data' in root) {
    return root['success'] === true ? asRecord(root['data']) : undefined;
  }
  return root;
}

export class NilesActorSession implements ActorSession {
  #accessToken: string;
  #destroyed = false;

  constructor(
    readonly actorProfileId: string,
    readonly userId: string,
    readonly tenantId: string | undefined,
    readonly correlationId: string,
    accessToken: string,
  ) {
    this.#accessToken = accessToken;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  async withAuthorization<T>(operation: (authorization: string) => Promise<T>): Promise<T> {
    if (this.#destroyed) {
      throw new AuthenticationBlockedError(
        'ACTOR_SESSION_DESTROYED',
        'The actor session is no longer available.',
        false,
      );
    }
    return operation(`Bearer ${this.#accessToken}`);
  }

  destroy(): void {
    this.#accessToken = '';
    this.#destroyed = true;
  }

  toJSON(): unknown {
    return {
      actorProfileId: this.actorProfileId,
      userId: this.userId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
      correlationId: this.correlationId,
      destroyed: this.destroyed,
    };
  }
}

export class NilesAuthenticationAdapter implements ActorAuthenticator {
  constructor(
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = DEFAULT_AUTHENTICATION_TIMEOUT_MS,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new RangeError(
        'Authentication timeout must be an integer between 1 and 30000 milliseconds.',
      );
    }
  }

  async authenticate(input: {
    environment: EnvironmentDefinitionV1;
    profile: ActorProfileV1;
    credential: AuthenticationCredential;
    correlationId: string;
  }): Promise<ActorSession> {
    if (input.environment.kind === 'production') {
      throw new AuthenticationBlockedError(
        'PRODUCTION_AUTH_PREFLIGHT_FORBIDDEN',
        'Authentication preflight is forbidden for production environments.',
        false,
        'ENVIRONMENT',
      );
    }

    let response: Response;
    try {
      response = await withAuthenticationTimeout(this.timeoutMs, (signal) =>
        input.credential.use((email, password) =>
          this.fetchImplementation(new URL('/auth/login', input.environment.baseUrl), {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'x-correlation-id': input.correlationId,
            },
            body: JSON.stringify({ email, password }),
            signal,
          }),
        ),
      );
    } catch (error) {
      const timedOut =
        error instanceof AuthenticationRequestTimeoutError ||
        (error instanceof Error && error.name === 'AbortError');
      throw new AuthenticationBlockedError(
        timedOut ? 'LOGIN_TIMEOUT' : 'LOGIN_NETWORK_FAILURE',
        timedOut
          ? 'NILES login did not respond within the authentication deadline.'
          : 'NILES login could not be reached.',
        true,
      );
    }

    if (!response.ok) {
      throw new AuthenticationBlockedError(
        response.status === 429 ? 'LOGIN_RATE_LIMITED' : 'LOGIN_DENIED',
        response.status === 429 ? 'NILES login was rate limited.' : 'NILES denied the actor login.',
        response.status === 429 || response.status >= 500,
      );
    }

    const payload = unwrapLoginPayload(await readJson(response));
    if (!payload) {
      throw new AuthenticationBlockedError(
        'LOGIN_RESPONSE_MALFORMED',
        'NILES returned an invalid login response.',
        false,
      );
    }
    if (payload['mfaRequired'] === true) {
      throw new AuthenticationBlockedError(
        'MFA_REQUIRED',
        'NILES requires an MFA challenge that M1-02A does not automate.',
        false,
      );
    }
    if (payload['passwordChangeRequired'] === true) {
      throw new AuthenticationBlockedError(
        'PASSWORD_CHANGE_REQUIRED',
        'NILES requires a password change before authenticated actor use is allowed.',
        false,
      );
    }

    const accessToken =
      typeof payload['accessToken'] === 'string' ? payload['accessToken'].trim() : '';
    if (!accessToken) {
      throw new AuthenticationBlockedError(
        'ACCESS_TOKEN_MISSING',
        'NILES login succeeded without a usable access token.',
        false,
      );
    }
    if (accessToken.length > 16_384) {
      throw new AuthenticationBlockedError(
        'LOGIN_RESPONSE_MALFORMED',
        'NILES returned an invalid login response.',
        false,
      );
    }

    const user = asRecord(payload['user']);
    if (user?.['mustChangePassword'] === true) {
      throw new AuthenticationBlockedError(
        'PASSWORD_CHANGE_REQUIRED',
        'NILES requires a password change before authenticated actor use is allowed.',
        false,
      );
    }

    const userId =
      typeof user?.['id'] === 'string' && user['id'].trim() ? user['id'].trim() : undefined;
    if (!userId || !UUID_PATTERN.test(userId)) {
      throw new AuthenticationBlockedError(
        'LOGIN_RESPONSE_MALFORMED',
        'NILES returned an invalid login response.',
        false,
      );
    }

    const rawTenantId =
      typeof user?.['tenantId'] === 'string' && user['tenantId'].trim()
        ? user['tenantId'].trim()
        : undefined;
    if (rawTenantId && !UUID_PATTERN.test(rawTenantId)) {
      throw new AuthenticationBlockedError(
        'LOGIN_RESPONSE_MALFORMED',
        'NILES returned an invalid login response.',
        false,
      );
    }

    return new NilesActorSession(
      input.profile.id,
      userId,
      rawTenantId,
      input.correlationId,
      accessToken,
    );
  }
}

class NilesLiveAdapterOperationError extends Error {
  readonly code: string;
  readonly category: 'PRODUCT' | 'ADAPTER' | 'ENVIRONMENT';
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    operation: string,
  ) {
    super(`NILES live API operation failed: ${operation}.`);
    this.name = 'NilesLiveAdapterOperationError';
    if (status === 0) {
      this.code = 'NILES_NETWORK_OR_TIMEOUT';
      this.category = 'ADAPTER';
      this.retryable = true;
    } else if (status === 400) {
      this.code = 'NILES_PRODUCT_RULE_REJECTED';
      this.category = 'PRODUCT';
      this.retryable = false;
    } else if (status === 401 || status === 403) {
      this.code = 'NILES_AUTHORIZATION_DENIED';
      this.category = 'ENVIRONMENT';
      this.retryable = false;
    } else if (status === 404) {
      this.code = 'NILES_RESOURCE_MISSING';
      this.category = 'ENVIRONMENT';
      this.retryable = false;
    } else if (status === 409) {
      this.code = 'NILES_CONFLICT';
      this.category = 'PRODUCT';
      this.retryable = false;
    } else if (status === 429) {
      this.code = 'NILES_RATE_LIMITED';
      this.category = 'ADAPTER';
      this.retryable = true;
    } else if (status >= 500) {
      this.code = status === 502 ? 'NILES_MALFORMED_RESPONSE' : 'NILES_UPSTREAM_FAILURE';
      this.category = 'ADAPTER';
      this.retryable = status !== 502;
    } else {
      this.code = 'NILES_LIVE_HTTP_FAILURE';
      this.category = 'ADAPTER';
      this.retryable = false;
    }
  }
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeIncident(value: unknown): NilesIncidentRecord {
  const payload = unwrapPayload(value);
  const id = safeString(payload?.['id']);
  if (!id || !UUID_PATTERN.test(id)) {
    throw new NilesLiveAdapterOperationError(502, 'normalize incident');
  }
  const number = safeString(payload?.['number']);
  const status = safeString(payload?.['status']);
  const priority = safeString(payload?.['priority']);
  const requesterId = safeString(payload?.['requesterId']);
  const assignmentGroupId = safeString(payload?.['assignmentGroupId']);
  const assignedTo = safeString(payload?.['assignedTo']);
  const incident: NilesIncidentRecord = { id };
  if (number) incident.number = number;
  if (status && ['open', 'in_progress', 'on_hold', 'resolved', 'closed'].includes(status)) {
    incident.status = status as NonNullable<NilesIncidentRecord['status']>;
  }
  if (priority && ['p1', 'p2', 'p3', 'p4'].includes(priority)) {
    incident.priority = priority as NonNullable<NilesIncidentRecord['priority']>;
  }
  if (requesterId) incident.requesterId = requesterId;
  if (assignmentGroupId) incident.assignmentGroupId = assignmentGroupId;
  if (assignedTo) incident.assignedTo = assignedTo;
  return incident;
}

function normalizeResource(
  value: unknown,
  expectedId: string,
  operation: string,
): NilesFixtureResource {
  const payload = unwrapPayload(value);
  const id = safeString(payload?.['id']);
  if (!id || id !== expectedId) {
    throw new NilesLiveAdapterOperationError(502, operation);
  }
  const label = safeString(payload?.['name']) ?? safeString(payload?.['displayName']);
  const serviceId = safeString(payload?.['serviceId']);
  return { id, ...(label ? { label } : {}), ...(serviceId ? { serviceId } : {}) };
}

function asArrayPayload(value: unknown): unknown[] {
  const payload = unwrapPayload(value);
  if (Array.isArray(payload)) {
    return payload;
  }
  const items = payload?.['items'];
  if (Array.isArray(items)) {
    return items;
  }
  return [];
}

export class NilesIncidentApiAdapter implements NilesIncidentLiveAdapter {
  constructor(
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = DEFAULT_AUTHENTICATION_TIMEOUT_MS,
  ) {}

  private async request(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    correlationId: string;
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    pathTemplate: string;
    operation: string;
    body?: unknown;
  }): Promise<{ payload: unknown; transport: NilesTransportEvidence }> {
    let response: Response;
    const startedAt = performance.now();
    try {
      response = await withAuthenticationTimeout(this.timeoutMs, (signal) =>
        input.session.withAuthorization((authorization) =>
          this.fetchImplementation(new URL(input.path, input.environment.baseUrl), {
            method: input.method,
            headers: {
              accept: 'application/json',
              authorization,
              'x-tenant-id': input.tenantId,
              'x-correlation-id': input.correlationId,
              ...(input.body ? { 'content-type': 'application/json' } : {}),
            },
            ...(input.body ? { body: JSON.stringify(input.body) } : {}),
            signal,
          }),
        ),
      );
    } catch {
      throw new NilesLiveAdapterOperationError(0, input.operation);
    }
    if (!response.ok) {
      throw new NilesLiveAdapterOperationError(response.status, input.operation);
    }
    return {
      payload: await readJson(response),
      transport: {
        method: input.method,
        pathTemplate: input.pathTemplate,
        httpStatus: response.status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        correlationId: input.correlationId,
      },
    };
  }

  verifyResource(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    kind: 'ASSIGNMENT_GROUP' | 'SERVICE' | 'OFFERING' | 'CI';
    id: string;
    correlationId: string;
  }): Promise<NilesFixtureResource> {
    const path =
      input.kind === 'ASSIGNMENT_GROUP'
        ? `/grc/groups/${input.id}`
        : input.kind === 'SERVICE'
          ? `/grc/cmdb/services/${input.id}`
          : input.kind === 'OFFERING'
            ? `/grc/cmdb/service-offerings/${input.id}`
            : `/grc/cmdb/cis/${input.id}`;
    const pathTemplate =
      input.kind === 'ASSIGNMENT_GROUP'
        ? '/grc/groups/:id'
        : input.kind === 'SERVICE'
          ? '/grc/cmdb/services/:id'
          : input.kind === 'OFFERING'
            ? '/grc/cmdb/service-offerings/:id'
            : '/grc/cmdb/cis/:id';
    return this.request({
      ...input,
      method: 'GET',
      path,
      pathTemplate,
      operation: `verify ${input.kind}`,
    }).then((response) => ({
      ...normalizeResource(response.payload, input.id, `verify ${input.kind}`),
      transport: response.transport,
    }));
  }

  createIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    correlationId: string;
    runId: string;
    runNamespacePrefix: string;
    requesterUserId: string;
    assignmentGroupId: string;
    serviceId: string;
    offeringId?: string;
    impact: 'low' | 'medium' | 'high';
    urgency: 'low' | 'medium' | 'high';
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: '/grc/itsm/incidents',
      pathTemplate: '/grc/itsm/incidents',
      operation: 'create incident',
      body: {
        shortDescription: `${input.runNamespacePrefix}-${input.runId} payment API degradation`,
        description:
          'Synthetic NVS live API validation for customer-facing payment API degradation.',
        category: 'software',
        source: 'user',
        impact: input.impact,
        urgency: input.urgency,
        requesterId: input.requesterUserId,
        assignmentGroupId: input.assignmentGroupId,
        serviceId: input.serviceId,
        ...(input.offeringId ? { offeringId: input.offeringId } : {}),
        metadata: {
          nvs: {
            schemaVersion: 'nvs.live-incident-metadata/v1',
            runId: input.runId,
            runNamespacePrefix: input.runNamespacePrefix,
            synthetic: true,
          },
        },
      },
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  readIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'GET',
      path: `/grc/itsm/incidents/${input.incidentId}`,
      pathTemplate: '/grc/itsm/incidents/:incidentId',
      operation: 'read incident',
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  assignIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    assignmentGroupId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/assign`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/assign',
      operation: 'assign incident',
      body: { assignmentGroupId: input.assignmentGroupId },
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  takeOwnership(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/take-ownership`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/take-ownership',
      operation: 'take ownership',
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  startWork(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/start-work`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/start-work',
      operation: 'start work',
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  async addAffectedCi(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    ciId: string;
    relationshipType: string;
    impactScope?: string;
    correlationId: string;
  }): Promise<NilesTransportEvidence> {
    const response = await this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/affected-cis`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
      operation: 'add affected CI',
      body: {
        ciId: input.ciId,
        relationshipType: input.relationshipType,
        ...(input.impactScope ? { impactScope: input.impactScope } : {}),
      },
    });
    return response.transport;
  }

  listAffectedCis(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<Array<{ ciId: string }>> {
    return this.request({
      ...input,
      method: 'GET',
      path: `/grc/itsm/incidents/${input.incidentId}/affected-cis`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/affected-cis',
      operation: 'list affected CIs',
    }).then((response) =>
      asArrayPayload(response.payload).flatMap((record) => {
        const value = asRecord(record) ?? {};
        const ciId =
          safeString(value['ciId']) ??
          safeString(value['configurationItemId']) ??
          safeString(asRecord(value['ci'])?.['id']);
        return ciId ? [{ ciId }] : [];
      }),
    );
  }

  readSlaSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesSlaSummary> {
    return this.request({
      ...input,
      method: 'GET',
      path: `/grc/itsm/sla/records/INCIDENT/${input.incidentId}`,
      pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',
      operation: 'read SLA summary',
    }).then((response) => ({
      transport: response.transport,
      records: asArrayPayload(response.payload).map((record) => {
        const value = asRecord(record) ?? {};
        const summary: NilesSlaSummary['records'][number] = {
          id: safeString(value['id']) ?? 'unknown',
        };
        const objectiveType = safeString(value['objectiveType']);
        const status = safeString(value['status']);
        if (objectiveType) summary.objectiveType = objectiveType;
        if (status) summary.status = status;
        if (typeof value['breached'] === 'boolean') summary.breached = value['breached'];
        const pauseAt = safeString(value['pauseAt']);
        const stopAt = safeString(value['stopAt']);
        if (pauseAt) summary.pauseAt = pauseAt;
        if (stopAt) summary.stopAt = stopAt;
        for (const key of [
          'elapsedSeconds',
          'remainingSeconds',
          'pausedDurationSeconds',
        ] as const) {
          if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
            summary[key] = value[key];
          }
        }
        return summary;
      }),
    }));
  }

  readJournalSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesJournalSummary> {
    return this.request({
      ...input,
      method: 'GET',
      path: `/grc/itsm/incidents/${input.incidentId}/journal`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/journal',
      operation: 'read journal count',
    }).then((response) => {
      const entries = asArrayPayload(response.payload).flatMap((entry) => {
        const value = asRecord(entry) ?? {};
        const id = safeString(value['id']);
        const action = safeString(value['action']);
        const createdBy = safeString(value['createdBy']);
        const createdAt = safeString(value['createdAt']);
        return id
          ? [
              {
                id,
                ...(action ? { action } : {}),
                ...(createdBy ? { createdBy } : {}),
                ...(createdAt ? { createdAt } : {}),
              },
            ]
          : [];
      });
      const value = unwrapPayload(response.payload);
      return {
        count: entries.length || (typeof value?.['count'] === 'number' ? value['count'] : 0),
        entries,
        transport: response.transport,
      };
    });
  }

  holdIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    pendingReason: string;
    pendingReasonDetail: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/hold`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/hold',
      operation: 'hold incident',
      body: {
        pendingReason: input.pendingReason,
        pendingReasonDetail: input.pendingReasonDetail,
      },
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  resumeIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/resume`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/resume',
      operation: 'resume incident',
      body: { status: 'in_progress' },
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  resolveIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    resolutionNotes: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/resolve`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/resolve',
      operation: 'resolve incident',
      body: { resolutionNotes: input.resolutionNotes },
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  closeIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    closureNote: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord> {
    return this.request({
      ...input,
      method: 'POST',
      path: `/grc/itsm/incidents/${input.incidentId}/close`,
      pathTemplate: '/grc/itsm/incidents/:incidentId/close',
      operation: 'close incident',
      body: { closureNote: input.closureNote },
    }).then((response) => ({
      ...normalizeIncident(response.payload),
      transport: response.transport,
    }));
  }

  async softDeleteIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesTransportEvidence> {
    const response = await this.request({
      ...input,
      method: 'DELETE',
      path: `/grc/itsm/incidents/${input.incidentId}`,
      pathTemplate: '/grc/itsm/incidents/:incidentId',
      operation: 'soft delete incident',
    });
    return response.transport;
  }

  async verifyIncidentDeleted(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<boolean> {
    try {
      await this.readIncident(input);
      return false;
    } catch (error) {
      return error instanceof NilesLiveAdapterOperationError && error.status === 404;
    }
  }
}
