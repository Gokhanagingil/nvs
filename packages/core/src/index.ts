import { randomUUID } from 'node:crypto';
import {
  actorListV1Schema,
  actorReadinessV1Schema,
  authPreflightV1Schema,
  executionReadinessV1Schema,
  evidenceManifestV1Schema,
  liveRunCheckpointV1Schema,
  resourceInventoryV1Schema,
  runRecordV1Schema,
  runRecordV2Schema,
  stepObservationV1Schema,
  type ActorCredentialConfiguration,
  type ActorListV1,
  type ActorProfileV1,
  type ActorReadinessV1,
  type AuthPreflightV1,
  type BusinessBlueprintV1,
  type CoverageCell,
  type EnvironmentDefinitionV1,
  type EnvironmentActorMapV1,
  type EvidenceManifestV1,
  type ExecutionReadinessV1,
  type ExecutablePlanV1,
  type LiveRunCheckpointV1,
  type NilesIncidentFixtureV1,
  type ProbeResultV1,
  type ResourceInventoryV1,
  type RunRecord,
  type RunRecordV1,
  type RunRecordV2,
  type StepObservationV1,
  type TypedError,
} from '@nvs/contracts';
import {
  classifyError,
  compileBlueprint,
  enforceEnvironmentOperationPolicy,
  typedError,
} from '@nvs/domain';

export interface EnvironmentRepository {
  list(): Promise<EnvironmentDefinitionV1[]>;
  get(id: string): Promise<EnvironmentDefinitionV1 | undefined>;
}

export interface ScenarioRepository {
  list(): Promise<BusinessBlueprintV1[]>;
  get(id: string): Promise<BusinessBlueprintV1 | undefined>;
}

export interface ActorProfileSet {
  mapping: EnvironmentActorMapV1;
  profiles: ActorProfileV1[];
}

export interface ActorProfileRepository {
  getForEnvironment(environmentId: string): Promise<ActorProfileSet>;
}

export type SecretConfigurationStatus = 'MISSING' | 'CONFIGURED' | 'INVALID';

export interface AuthenticationCredential {
  use<T>(operation: (email: string, password: string) => Promise<T>): Promise<T>;
  destroy(): void;
  toJSON(): string;
}

export interface SecretProvider {
  configurationStatus(reference: string): Promise<SecretConfigurationStatus>;
  resolve(reference: string): Promise<AuthenticationCredential>;
}

export interface ActorSession {
  readonly actorProfileId: string;
  readonly userId: string;
  readonly tenantId: string | undefined;
  readonly correlationId: string;
  readonly destroyed: boolean;
  withAuthorization<T>(operation: (authorization: string) => Promise<T>): Promise<T>;
  destroy(): void;
  toJSON(): unknown;
}

export interface ActorAuthenticator {
  authenticate(input: {
    environment: EnvironmentDefinitionV1;
    profile: ActorProfileV1;
    credential: AuthenticationCredential;
    correlationId: string;
  }): Promise<ActorSession>;
}

export class AuthenticationBlockedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly category: 'ADAPTER' | 'ENVIRONMENT' = 'ADAPTER',
  ) {
    super(message);
    this.name = 'AuthenticationBlockedError';
  }
}

export interface ActorReadinessDependencies {
  profiles: ActorProfileRepository;
  secrets: SecretProvider;
  authenticator: ActorAuthenticator;
  clock?: () => string;
  monotonicClock?: () => number;
  correlationIdFactory?: () => string;
}

export interface RunBundle {
  run: RunRecord;
  plan: ExecutablePlanV1;
  evidenceManifest: EvidenceManifestV1;
  resourceInventory?: ResourceInventoryV1;
  observations?: StepObservationV1[];
  checkpoint?: LiveRunCheckpointV1;
}

export interface RunBundleRepository {
  reserveRunId?(runId: string): Promise<void>;
  saveBundle(bundle: RunBundle): Promise<RunRecord>;
  list(): Promise<RunRecord[]>;
  get(id: string): Promise<RunRecord | undefined>;
  getPlan(id: string): Promise<ExecutablePlanV1 | undefined>;
  getEvidence(runId: string): Promise<EvidenceManifestV1 | undefined>;
  getResourceInventory?(runId: string): Promise<ResourceInventoryV1 | undefined>;
  getStepObservations?(runId: string): Promise<StepObservationV1[] | undefined>;
  getLiveCheckpoint?(runId: string): Promise<LiveRunCheckpointV1 | undefined>;
}

export interface LiveRunState {
  runId: string;
  plan: ExecutablePlanV1;
  checkpoint: LiveRunCheckpointV1;
  resourceInventory: ResourceInventoryV1;
  observations: StepObservationV1[];
}

export interface LiveRunStateRepository {
  reserve(state: LiveRunState): Promise<void>;
  save(state: LiveRunState): Promise<void>;
  get(runId: string): Promise<LiveRunState | undefined>;
  listActive(): Promise<LiveRunState[]>;
  complete(runId: string): Promise<void>;
}

export interface EnvironmentProbe {
  probe(environment: EnvironmentDefinitionV1): Promise<ProbeResultV1>;
}

export interface NilesIncidentFixtureRepository {
  getForEnvironment(environmentId: string): Promise<NilesIncidentFixtureV1 | undefined>;
}

export interface NilesIncidentRecord {
  id: string;
  number?: string;
  status?: 'open' | 'in_progress' | 'on_hold' | 'resolved' | 'closed';
  priority?: 'p1' | 'p2' | 'p3' | 'p4';
  requesterId?: string | null;
  assignmentGroupId?: string | null;
  assignedTo?: string | null;
  transport?: NilesTransportEvidence;
}

export interface NilesFixtureResource {
  id: string;
  label?: string;
  serviceId?: string;
  transport?: NilesTransportEvidence;
}

export interface NilesTransportEvidence {
  method: 'GET' | 'POST' | 'DELETE';
  pathTemplate: string;
  httpStatus?: number;
  durationMs: number;
  correlationId: string;
}

export interface NilesAffectedCiSummary {
  items: Array<{ ciId: string }>;
  transport?: NilesTransportEvidence;
}

export interface NilesSlaSummary {
  records: Array<{
    id: string;
    objectiveType?: 'response' | 'resolution' | string;
    status?: string;
    policyRef?: string;
    breached?: boolean;
    pauseAt?: string;
    stopAt?: string;
    elapsedSeconds?: number;
    remainingSeconds?: number;
    pausedDurationSeconds?: number;
  }>;
  transport?: NilesTransportEvidence;
}

export interface NilesJournalSummary {
  count: number;
  entries?: Array<{
    id: string;
    type?: string;
    message?: string;
    createdBy?: string;
    createdAt?: string;
  }>;
  transport?: NilesTransportEvidence;
}

export interface NilesIncidentLiveAdapter {
  verifyResource(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    kind: 'ASSIGNMENT_GROUP' | 'SERVICE' | 'OFFERING' | 'CI';
    id: string;
    correlationId: string;
  }): Promise<NilesFixtureResource>;
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
  }): Promise<NilesIncidentRecord>;
  readIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  assignIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    assignmentGroupId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  takeOwnership(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  startWork(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  addAffectedCi(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    ciId: string;
    relationshipType: string;
    impactScope?: string;
    correlationId: string;
  }): Promise<NilesTransportEvidence | void>;
  listAffectedCis(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesAffectedCiSummary>;
  readSlaSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesSlaSummary>;
  readJournalSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesJournalSummary>;
  holdIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    pendingReason: string;
    pendingReasonDetail: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  resumeIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  resolveIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    resolutionNotes: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  closeIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    closureNote: string;
    correlationId: string;
  }): Promise<NilesIncidentRecord>;
  softDeleteIncident(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesTransportEvidence | void>;
  verifyIncidentDeleted(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<boolean>;
}

export interface LiveExecutionDependencies {
  fixtures: NilesIncidentFixtureRepository;
  incidentAdapter: NilesIncidentLiveAdapter;
  state?: LiveRunStateRepository;
  mutationsEnabled?: () => boolean;
  clock?: () => string;
  monotonicClock?: () => number;
  correlationIdFactory?: (seed: string) => string;
  backgroundCoordinator?: (operation: () => Promise<void>) => void;
}

export interface CompileOnlyRunInput {
  runId: string;
  environmentId: string;
  scenarioId: string;
  variationValues?: Record<string, string>;
  now: string;
  target?: { version?: string; commit?: string };
}

export interface LiveApiRunInput {
  runId: string;
  environmentId: string;
  scenarioId: string;
  variationValues?: Record<string, string>;
  confirmRealMutation: boolean;
  now: string;
  target?: { version?: string; commit?: string };
}

export interface LiveRunAccepted {
  schemaVersion: 'nvs.live-run-accepted/v1';
  runId: string;
  status: 'ACCEPTED';
}

export class LiveRunBlockedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly category: TypedError['category'] = 'ENVIRONMENT',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LiveRunBlockedError';
  }
}

class LiveStepError extends Error {
  constructor(readonly typed: TypedError) {
    super(typed.message);
    this.name = 'LiveStepError';
  }
}

class LiveStatePersistenceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Live run state persistence failed.');
    this.name = 'LiveStatePersistenceError';
  }
}

class PreflightSessionCache {
  private readonly sessions = new Map<string, ActorSession>();

  add(session: ActorSession): void {
    const existing = this.sessions.get(session.actorProfileId);
    existing?.destroy();
    this.sessions.set(session.actorProfileId, session);
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      session.destroy();
    }
    this.sessions.clear();
  }
}

function publicConfigurationState(
  environment: EnvironmentDefinitionV1,
  profile: ActorProfileV1,
  status: SecretConfigurationStatus,
): ActorCredentialConfiguration {
  if (!environment.enabled || !profile.enabled) {
    return 'DISABLED';
  }
  if (status === 'MISSING') {
    return 'NOT_CONFIGURED';
  }
  return status === 'CONFIGURED' ? 'CONFIGURED' : 'INVALID';
}

function blockedError(
  code: string,
  message: string,
  retryable = false,
  category: 'ADAPTER' | 'ENVIRONMENT' = 'ENVIRONMENT',
): TypedError {
  return { category, code, message, retryable };
}

function safeAuthenticationError(error: unknown): TypedError {
  if (error instanceof AuthenticationBlockedError) {
    return {
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return blockedError(
    'AUTHENTICATION_ADAPTER_FAILURE',
    'Actor authentication could not be completed safely.',
    false,
    'ADAPTER',
  );
}

function safeLiveError(error: unknown): TypedError {
  if (error instanceof LiveStepError) {
    return error.typed;
  }
  if (error instanceof LiveRunBlockedError) {
    return {
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof AuthenticationBlockedError) {
    return safeAuthenticationError(error);
  }
  if (
    error instanceof Error &&
    'code' in error &&
    'category' in error &&
    'retryable' in error &&
    typeof error.code === 'string' &&
    typeof error.category === 'string' &&
    typeof error.retryable === 'boolean'
  ) {
    const category = error.category as TypedError['category'];
    if (
      [
        'PRODUCT',
        'ASSERTION',
        'ADAPTER',
        'ENVIRONMENT',
        'SCENARIO_CONTRACT',
        'PERSISTENCE',
        'CLEANUP',
        'CANCELLATION',
      ].includes(category)
    ) {
      return {
        category,
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      };
    }
  }
  return blockedError(
    'NILES_LIVE_ADAPTER_FAILURE',
    'The live NILES API operation could not be completed safely.',
    false,
    'ADAPTER',
  );
}

function requireLiveAssertion(condition: boolean, code: string, message: string): void {
  if (!condition) {
    throw new LiveStepError(typedError('ASSERTION', code, message));
  }
}

type LiveObservationOperation = {
  method: 'GET' | 'POST' | 'DELETE';
  pathTemplate: string;
  httpStatus?: number;
  durationMs: number;
  correlationId: string;
};
type LiveObservationPayload = Record<
  string,
  string | number | boolean | null | LiveObservationOperation[]
>;
type LiveObservationOutcome =
  LiveObservationPayload | { status: 'PASS' | 'NOT_OBSERVED'; evidence: LiveObservationPayload };

function normalizeObservationOutcome(outcome: LiveObservationOutcome): {
  status: 'PASS' | 'NOT_OBSERVED';
  evidence: LiveObservationPayload;
} {
  if ('status' in outcome && 'evidence' in outcome) {
    return outcome as { status: 'PASS' | 'NOT_OBSERVED'; evidence: LiveObservationPayload };
  }
  return { status: 'PASS', evidence: outcome };
}

function transportObservation(
  transport: NilesTransportEvidence | undefined,
): LiveObservationPayload {
  return transport
    ? {
        method: transport.method,
        pathTemplate: transport.pathTemplate,
        ...(transport.httpStatus !== undefined ? { httpStatus: transport.httpStatus } : {}),
        durationMs: transport.durationMs,
        correlationId: transport.correlationId,
      }
    : {};
}

function transportOperation(
  transport: NilesTransportEvidence | undefined,
): LiveObservationOperation | undefined {
  return transport
    ? {
        method: transport.method,
        pathTemplate: transport.pathTemplate,
        ...(transport.httpStatus !== undefined ? { httpStatus: transport.httpStatus } : {}),
        durationMs: transport.durationMs,
        correlationId: transport.correlationId,
      }
    : undefined;
}

function operationsEvidence(
  transports: Array<NilesTransportEvidence | undefined>,
): LiveObservationPayload {
  const operations = transports.flatMap((transport) => {
    const operation = transportOperation(transport);
    return operation ? [operation] : [];
  });
  return operations.length > 0 ? { operations } : {};
}

function errorTransportEvidence(error: unknown): LiveObservationPayload {
  const transport =
    error instanceof Error && 'transport' in error
      ? (error.transport as NilesTransportEvidence | undefined)
      : undefined;
  const operations =
    error instanceof Error && 'operations' in error
      ? (error.operations as NilesTransportEvidence[] | undefined)
      : undefined;
  return {
    ...(transport ? transportObservation(transport) : {}),
    ...operationsEvidence(operations ?? (transport ? [transport] : [])),
  };
}

function attachOperationEvidence<T extends Error>(
  error: T,
  transports: Array<NilesTransportEvidence | undefined>,
): T {
  const errorTransport =
    'transport' in error ? (error.transport as NilesTransportEvidence | undefined) : undefined;
  const operations = [...transports, errorTransport].filter(
    (transport): transport is NilesTransportEvidence => transport !== undefined,
  );
  if (operations.length > 0) {
    Object.defineProperty(error, 'operations', {
      value: operations,
      enumerable: false,
      configurable: true,
    });
  }
  return error;
}

function observedSlaObjectiveTypes(summary: NilesSlaSummary): Set<string> {
  return new Set(
    summary.records
      .map((record) => record.objectiveType?.toLowerCase())
      .filter((objectiveType): objectiveType is string => Boolean(objectiveType)),
  );
}

function assertRequiredSlaObjectives(
  summary: NilesSlaSummary,
  requiredObjectiveTypes: string[],
): void {
  const observed = observedSlaObjectiveTypes(summary);
  const missing = requiredObjectiveTypes.filter((objectiveType) => !observed.has(objectiveType));
  if (summary.records.length === 0 || missing.length > 0) {
    throw new LiveStepError(
      typedError(
        'ENVIRONMENT',
        'SLA_SUMMARY_MISSING',
        missing.length > 0
          ? `Required SLA objective(s) were not observable: ${missing.join(', ')}.`
          : 'Required SLA summary records were not observable for the incident.',
      ),
    );
  }
}

function assertObservedSlaPolicy(summary: NilesSlaSummary, expectedPolicyRef?: string): void {
  if (!expectedPolicyRef) {
    return;
  }
  const observedPolicyRefs = new Set(
    summary.records
      .map((record) => record.policyRef)
      .filter((policyRef): policyRef is string => Boolean(policyRef)),
  );
  if (observedPolicyRefs.size > 0 && !observedPolicyRefs.has(expectedPolicyRef)) {
    throw new LiveStepError(
      typedError(
        'ASSERTION',
        'SLA_POLICY_MISMATCH',
        'Observed SLA records did not reference the configured fixture SLA policy.',
      ),
    );
  }
}

function isRunningSlaStatus(status: string | undefined): boolean {
  return ['running', 'active', 'in_progress', 'in progress'].includes(status?.toLowerCase() ?? '');
}

function isPausedSlaRecord(record: NilesSlaSummary['records'][number]): boolean {
  return Boolean(
    record.pauseAt ||
    (record.pausedDurationSeconds ?? 0) > 0 ||
    ['paused', 'on_hold', 'held'].includes(record.status?.toLowerCase() ?? ''),
  );
}

function isStoppedResolutionSlaRecord(record: NilesSlaSummary['records'][number]): boolean {
  return Boolean(
    record.objectiveType?.toLowerCase() === 'resolution' &&
    (record.stopAt ||
      ['completed', 'stopped', 'met', 'breached', 'resolved'].includes(
        record.status?.toLowerCase() ?? '',
      )),
  );
}

type JournalLifecycleAction = 'hold' | 'resume' | 'resolve';

const JOURNAL_ACTION_PREFIXES: Record<JournalLifecycleAction, string> = {
  hold: 'Incident placed on hold.',
  resume: 'Incident resumed.',
  resolve: 'Incident resolved by operator.',
};

function hasStableJournalAttribution(
  entry: NonNullable<NilesJournalSummary['entries']>[number],
  action: JournalLifecycleAction,
  expectedUserId: string,
): boolean {
  return Boolean(
    entry.type === 'action' &&
    entry.createdBy === expectedUserId &&
    entry.message?.startsWith(JOURNAL_ACTION_PREFIXES[action]),
  );
}

export class NvsCore {
  private activeLiveRunId: string | undefined;
  private readonly liveRunTasks = new Map<string, Promise<RunRecordV2>>();
  private readonly memoryLiveStates = new Map<string, LiveRunState>();
  private readonly memoryReservedRunIds = new Set<string>();

  constructor(
    private readonly environments: EnvironmentRepository,
    private readonly scenarios: ScenarioRepository,
    private readonly bundles: RunBundleRepository,
    private readonly probeAdapter: EnvironmentProbe,
    private readonly actorReadiness?: ActorReadinessDependencies,
    private readonly liveExecution?: LiveExecutionDependencies,
  ) {}

  private liveStateRepository(): LiveRunStateRepository {
    if (this.liveExecution?.state) {
      return this.liveExecution.state;
    }
    return {
      reserve: async (state) => {
        if (this.memoryLiveStates.has(state.runId) || (await this.bundles.get(state.runId))) {
          throw new LiveRunBlockedError(
            'RUN_ID_ALREADY_EXISTS',
            'A run with this identifier already exists.',
            'PERSISTENCE',
          );
        }
        this.memoryLiveStates.set(state.runId, state);
      },
      save: async (state) => {
        this.memoryLiveStates.set(state.runId, state);
      },
      get: async (runId) => this.memoryLiveStates.get(runId),
      listActive: async () =>
        [...this.memoryLiveStates.values()].filter(
          (state) => state.checkpoint.status !== 'COMPLETED',
        ),
      complete: async (runId) => {
        const state = this.memoryLiveStates.get(runId);
        if (state) {
          this.memoryLiveStates.set(runId, {
            ...state,
            checkpoint: { ...state.checkpoint, status: 'COMPLETED' },
          });
        }
      },
    };
  }

  private async reserveRunId(runId: string): Promise<void> {
    if (this.bundles.reserveRunId) {
      try {
        await this.bundles.reserveRunId(runId);
      } catch (error) {
        throw safeLiveError(error).code === 'RUN_ID_ALREADY_EXISTS'
          ? new LiveRunBlockedError(
              'RUN_ID_ALREADY_EXISTS',
              'A run with this identifier already exists.',
              'PERSISTENCE',
            )
          : error;
      }
      return;
    }
    if (
      this.memoryReservedRunIds.has(runId) ||
      this.memoryLiveStates.has(runId) ||
      (await this.bundles.get(runId))
    ) {
      throw new LiveRunBlockedError(
        'RUN_ID_ALREADY_EXISTS',
        'A run with this identifier already exists.',
        'PERSISTENCE',
      );
    }
    this.memoryReservedRunIds.add(runId);
  }

  private scheduleLiveRun(runId: string, operation: () => Promise<RunRecordV2>): void {
    const coordinator =
      this.liveExecution?.backgroundCoordinator ??
      ((scheduled: () => Promise<void>) => {
        void scheduled().catch(() => undefined);
      });
    const task = new Promise<RunRecordV2>((resolve, reject) => {
      coordinator(async () => {
        try {
          resolve(await operation());
        } catch (error) {
          reject(error);
        } finally {
          this.liveRunTasks.delete(runId);
          if (this.activeLiveRunId === runId) {
            this.activeLiveRunId = undefined;
          }
        }
      });
    });
    task.catch(() => undefined);
    this.liveRunTasks.set(runId, task);
  }

  async waitForLiveRun(runId: string): Promise<RunRecordV2> {
    const task = this.liveRunTasks.get(runId);
    if (task) {
      return task;
    }
    const run = await this.bundles.get(runId);
    if (run?.runType === 'LIVE_API') {
      return run;
    }
    throw new Error(`Run "${runId}" was not found.`);
  }

  listEnvironments(): Promise<EnvironmentDefinitionV1[]> {
    return this.environments.list();
  }

  async getEnvironment(id: string): Promise<EnvironmentDefinitionV1> {
    const environment = await this.environments.get(id);
    if (!environment) {
      throw new Error(`Environment "${id}" was not found.`);
    }
    return environment;
  }

  async probeEnvironment(id: string): Promise<ProbeResultV1> {
    const environment = await this.getEnvironment(id);
    enforceEnvironmentOperationPolicy(environment, 'READ_ONLY');
    if (!environment.enabled) {
      return {
        environmentId: environment.id,
        verdict: 'BLOCKED',
        health: { available: false },
        readiness: { available: false },
        openApi: { available: false },
        version: { available: false, source: 'NONE' },
        error: {
          category: 'ENVIRONMENT',
          code: 'ENVIRONMENT_DISABLED',
          message: 'The environment is disabled.',
          retryable: false,
        },
      };
    }
    return this.probeAdapter.probe(environment);
  }

  private actorDependencies(): Required<
    Pick<ActorReadinessDependencies, 'profiles' | 'secrets' | 'authenticator'>
  > &
    Pick<ActorReadinessDependencies, 'clock' | 'monotonicClock' | 'correlationIdFactory'> {
    if (!this.actorReadiness) {
      throw new AuthenticationBlockedError(
        'ACTOR_READINESS_NOT_CONFIGURED',
        'Actor readiness is not configured for this NVS instance.',
        false,
        'ENVIRONMENT',
      );
    }
    return this.actorReadiness;
  }

  async listActorReadiness(environmentId: string): Promise<ActorListV1> {
    const environment = await this.getEnvironment(environmentId);
    const dependencies = this.actorDependencies();
    const profileSet = await dependencies.profiles.getForEnvironment(environment.id);
    const actors = await Promise.all(
      profileSet.profiles.map(async (profile): Promise<ActorReadinessV1> => {
        const configurationStatus = await dependencies.secrets.configurationStatus(
          profile.credentialRef,
        );
        const credentialConfiguration = publicConfigurationState(
          environment,
          profile,
          configurationStatus,
        );
        return actorReadinessV1Schema.parse({
          actorProfileId: profile.id,
          displayName: profile.displayName,
          persona: profile.persona,
          credentialConfiguration,
          authenticationState:
            credentialConfiguration === 'DISABLED' ? 'DISABLED' : 'NOT_ATTEMPTED',
          ...(profile.tenantId ? { expectedTenantId: profile.tenantId } : {}),
        });
      }),
    );
    return actorListV1Schema.parse({
      schemaVersion: 'nvs.actor-list/v1',
      environmentId: environment.id,
      gateEligible: false,
      actors,
    });
  }

  async runAuthenticationPreflight(environmentId: string): Promise<AuthPreflightV1> {
    const environment = await this.getEnvironment(environmentId);
    if (environment.kind === 'production') {
      throw new AuthenticationBlockedError(
        'PRODUCTION_AUTH_PREFLIGHT_FORBIDDEN',
        'Authentication preflight is forbidden for production environments.',
        false,
        'ENVIRONMENT',
      );
    }
    const dependencies = this.actorDependencies();
    const profileSet = await dependencies.profiles.getForEnvironment(environment.id);
    const clock = dependencies.clock ?? (() => new Date().toISOString());
    const monotonicClock = dependencies.monotonicClock ?? (() => performance.now());
    const correlationIdFactory =
      dependencies.correlationIdFactory ??
      (() => `auth_${randomUUID().toLowerCase().replaceAll('-', '')}`);
    const startedAt = clock();
    const cache = new PreflightSessionCache();
    const actors: ActorReadinessV1[] = [];

    try {
      for (const profile of profileSet.profiles) {
        const started = monotonicClock();
        const correlationId = correlationIdFactory();
        const configurationStatus = await dependencies.secrets.configurationStatus(
          profile.credentialRef,
        );
        const credentialConfiguration = publicConfigurationState(
          environment,
          profile,
          configurationStatus,
        );
        const common = {
          actorProfileId: profile.id,
          displayName: profile.displayName,
          persona: profile.persona,
          credentialConfiguration,
          correlationId,
          ...(profile.tenantId ? { expectedTenantId: profile.tenantId } : {}),
        };

        if (!environment.enabled || !profile.enabled) {
          actors.push(
            actorReadinessV1Schema.parse({
              ...common,
              authenticationState: 'DISABLED',
              durationMs: Math.max(0, Math.round(monotonicClock() - started)),
              timestamp: clock(),
            }),
          );
          continue;
        }

        let policyError: TypedError | undefined;
        if (configurationStatus === 'MISSING') {
          policyError = blockedError(
            'CREDENTIAL_MISSING',
            'The actor credential reference is not configured.',
          );
        } else if (configurationStatus === 'INVALID') {
          policyError = blockedError(
            'CREDENTIAL_INVALID',
            'The actor credential configuration is invalid.',
          );
        } else if (profile.mfa !== 'NOT_EXPECTED') {
          policyError = blockedError(
            'MFA_NOT_AUTOMATABLE',
            'The actor profile requires an unsupported automated MFA flow.',
          );
        }

        if (policyError) {
          actors.push(
            actorReadinessV1Schema.parse({
              ...common,
              authenticationState: 'BLOCKED',
              durationMs: Math.max(0, Math.round(monotonicClock() - started)),
              timestamp: clock(),
              error: policyError,
            }),
          );
          continue;
        }

        let credential: AuthenticationCredential | undefined;
        let session: ActorSession | undefined;
        try {
          credential = await dependencies.secrets.resolve(profile.credentialRef);
          session = await dependencies.authenticator.authenticate({
            environment,
            profile,
            credential,
            correlationId,
          });
          cache.add(session);
          if (profile.tenantId && session.tenantId !== profile.tenantId) {
            throw new AuthenticationBlockedError(
              session.tenantId ? 'TENANT_MISMATCH' : 'TENANT_CONTEXT_MISSING',
              session.tenantId
                ? 'The authenticated actor tenant does not match the configured tenant.'
                : 'The authenticated actor response did not include the configured tenant context.',
              false,
            );
          }
          actors.push(
            actorReadinessV1Schema.parse({
              ...common,
              authenticationState: 'AUTHENTICATED',
              userId: session.userId,
              ...(session.tenantId ? { observedTenantId: session.tenantId } : {}),
              durationMs: Math.max(0, Math.round(monotonicClock() - started)),
              timestamp: clock(),
            }),
          );
        } catch (error) {
          actors.push(
            actorReadinessV1Schema.parse({
              ...common,
              authenticationState: 'BLOCKED',
              ...(session?.tenantId ? { observedTenantId: session.tenantId } : {}),
              durationMs: Math.max(0, Math.round(monotonicClock() - started)),
              timestamp: clock(),
              error: safeAuthenticationError(error),
            }),
          );
        } finally {
          credential?.destroy();
        }
      }
    } finally {
      cache.clear();
    }

    return authPreflightV1Schema.parse({
      schemaVersion: 'nvs.auth-preflight/v1',
      environmentId: environment.id,
      verdict: actors.every((actor) => actor.authenticationState === 'AUTHENTICATED')
        ? 'PASS'
        : 'BLOCKED',
      gateEligible: false,
      assuranceScope: 'AUTHENTICATION_READINESS_ONLY',
      startedAt,
      completedAt: clock(),
      actors,
    });
  }

  private liveDependencies(): LiveExecutionDependencies {
    if (!this.liveExecution) {
      throw new LiveRunBlockedError(
        'LIVE_EXECUTION_NOT_CONFIGURED',
        'Live API execution is not configured for this NVS instance.',
      );
    }
    return this.liveExecution;
  }

  private liveClock(): () => string {
    return (
      this.liveExecution?.clock ?? this.actorReadiness?.clock ?? (() => new Date().toISOString())
    );
  }

  private liveCorrelation(seed: string): string {
    return (
      this.liveExecution?.correlationIdFactory?.(seed) ??
      `live_${seed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 72)}`
    );
  }

  private liveMutationSwitchEnabled(): boolean {
    return this.liveExecution?.mutationsEnabled?.() ?? false;
  }

  private async authenticateLiveActors(
    environment: EnvironmentDefinitionV1,
    fixture: NilesIncidentFixtureV1,
    runId: string,
  ): Promise<{
    requester: ActorSession;
    serviceDesk: ActorSession;
    incidentManager: ActorSession;
    tenantAdmin: ActorSession;
    destroy: () => void;
  }> {
    const dependencies = this.actorDependencies();
    const profileSet = await dependencies.profiles.getForEnvironment(environment.id);
    const byPersona = new Map(profileSet.profiles.map((profile) => [profile.persona, profile]));
    const sessions: ActorSession[] = [];
    const authenticatePersona = async (
      persona: 'requester' | 'service-desk-agent' | 'incident-manager' | 'tenant-admin',
    ): Promise<ActorSession> => {
      const profile = byPersona.get(persona);
      if (!profile) {
        throw new LiveRunBlockedError(
          'LIVE_ACTOR_PROFILE_MISSING',
          `The required ${persona} actor profile is missing.`,
        );
      }
      if (!environment.enabled || !profile.enabled) {
        throw new LiveRunBlockedError(
          'LIVE_ACTOR_PROFILE_DISABLED',
          `The required ${persona} actor profile is disabled.`,
        );
      }
      if (profile.mfa !== 'NOT_EXPECTED') {
        throw new LiveRunBlockedError(
          'MFA_NOT_AUTOMATABLE',
          'The live API actor requires an unsupported automated MFA flow.',
          'ADAPTER',
        );
      }
      const configurationStatus = await dependencies.secrets.configurationStatus(
        profile.credentialRef,
      );
      if (configurationStatus !== 'CONFIGURED') {
        throw new LiveRunBlockedError(
          configurationStatus === 'MISSING' ? 'CREDENTIAL_MISSING' : 'CREDENTIAL_INVALID',
          'A required live API actor credential is not configured safely.',
        );
      }

      let credential: AuthenticationCredential | undefined;
      try {
        credential = await dependencies.secrets.resolve(profile.credentialRef);
        const session = await dependencies.authenticator.authenticate({
          environment,
          profile,
          credential,
          correlationId: this.liveCorrelation(`${runId}_${persona}_login`),
        });
        if (session.tenantId !== fixture.tenantId) {
          session.destroy();
          throw new LiveRunBlockedError(
            session.tenantId ? 'TENANT_MISMATCH' : 'TENANT_CONTEXT_MISSING',
            session.tenantId
              ? 'A live API actor authenticated into an unexpected tenant.'
              : 'A live API actor did not return the required tenant context.',
          );
        }
        sessions.push(session);
        return session;
      } finally {
        credential?.destroy();
      }
    };

    try {
      const requester = await authenticatePersona('requester');
      const serviceDesk = await authenticatePersona('service-desk-agent');
      const incidentManager = await authenticatePersona('incident-manager');
      const tenantAdmin = await authenticatePersona('tenant-admin');
      return {
        requester,
        serviceDesk,
        incidentManager,
        tenantAdmin,
        destroy() {
          sessions.forEach((session) => session.destroy());
        },
      };
    } catch (error) {
      sessions.forEach((session) => session.destroy());
      throw error;
    }
  }

  private allowlistMatches(
    entries: ReadonlyArray<{ scenarioId: string; variationValues: Record<string, string> }>,
    scenarioId: string,
    variationValues: Record<string, string>,
  ): boolean {
    return entries.some((entry) => {
      if (entry.scenarioId !== scenarioId) {
        return false;
      }
      const entryPairs = Object.entries(entry.variationValues).sort();
      const requestedPairs = Object.entries(variationValues).sort();
      return JSON.stringify(entryPairs) === JSON.stringify(requestedPairs);
    });
  }

  async executionReadiness(input: {
    environmentId: string;
    scenarioId?: string;
    variationValues?: Record<string, string>;
  }): Promise<ExecutionReadinessV1> {
    const environment = await this.getEnvironment(input.environmentId);
    const checks: ExecutionReadinessV1['checks'] = [];
    const block = (id: string, code: string, message: string): void => {
      checks.push({ id, status: 'BLOCKED', code, message });
    };
    const pass = (id: string, message: string): void => {
      checks.push({ id, status: 'PASS', message });
    };

    if (!environment.enabled) {
      block('environment-enabled', 'ENVIRONMENT_DISABLED', 'The environment is disabled.');
    } else {
      pass('environment-enabled', 'The environment is enabled.');
    }

    if (environment.kind === 'production') {
      block(
        'non-production',
        'PRODUCTION_MUTATION_FORBIDDEN',
        'Live API mutation is forbidden for production environments.',
      );
      return executionReadinessV1Schema.parse({
        schemaVersion: 'nvs.execution-readiness/v1',
        environmentId: environment.id,
        runType: 'LIVE_API',
        ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
        ...(input.variationValues ? { variationValues: input.variationValues } : {}),
        verdict: 'BLOCKED',
        mutationEligible: false,
        gateEligible: false,
        checks,
        error: typedError(
          'ENVIRONMENT',
          'PRODUCTION_MUTATION_FORBIDDEN',
          'Live API mutation is forbidden for production environments.',
        ),
      });
    }
    pass('non-production', 'The environment is not production.');

    const policy = environment.execution;
    if (!policy?.liveApiEnabled || !policy.allowedRunTypes.includes('LIVE_API')) {
      block(
        'environment-live-policy',
        'LIVE_API_POLICY_DISABLED',
        'The environment execution policy does not enable LIVE_API.',
      );
    } else {
      pass('environment-live-policy', 'The environment execution policy enables LIVE_API.');
    }

    if (!this.liveMutationSwitchEnabled()) {
      block(
        'server-mutation-switch',
        'NILES_MUTATIONS_DISABLED',
        'The server-owned NVS_ENABLE_NILES_MUTATIONS switch is not enabled.',
      );
    } else {
      pass('server-mutation-switch', 'The server-owned mutation switch is enabled.');
    }

    let fixture: NilesIncidentFixtureV1 | undefined;
    if (!this.liveExecution) {
      block(
        'fixture-profile',
        'LIVE_EXECUTION_NOT_CONFIGURED',
        'Live API execution dependencies are not configured.',
      );
    } else {
      fixture = await this.liveExecution.fixtures.getForEnvironment(environment.id);
      if (!fixture) {
        block(
          'fixture-profile',
          'NILES_INCIDENT_FIXTURE_MISSING',
          'No NILES incident fixture is configured for this environment.',
        );
      } else if (!fixture.enabled) {
        block(
          'fixture-profile',
          'NILES_INCIDENT_FIXTURE_DISABLED',
          'The configured NILES incident fixture is disabled.',
        );
      } else if (policy?.fixtureProfileRef && policy.fixtureProfileRef !== fixture.id) {
        block(
          'fixture-profile',
          'NILES_INCIDENT_FIXTURE_MISMATCH',
          'The environment execution policy does not reference the configured fixture.',
        );
      } else {
        pass('fixture-profile', 'The NILES incident fixture is present and enabled.');
      }
    }

    const selectedScenarioId = input.scenarioId;
    const selectedVariationValues = input.variationValues ?? {};
    if (selectedScenarioId) {
      const policyAllowlisted = policy
        ? this.allowlistMatches(
            policy.liveRunAllowlist,
            selectedScenarioId,
            selectedVariationValues,
          )
        : false;
      const fixtureAllowlisted = fixture
        ? this.allowlistMatches(
            fixture.scenarioAllowlist,
            selectedScenarioId,
            selectedVariationValues,
          )
        : false;
      if (!policyAllowlisted || !fixtureAllowlisted) {
        block(
          'scenario-allowlist',
          'LIVE_SCENARIO_NOT_ALLOWLISTED',
          'The requested scenario variation is not allowlisted for live API execution.',
        );
      } else {
        pass('scenario-allowlist', 'The requested scenario variation is allowlisted.');
      }
    } else {
      checks.push({
        id: 'scenario-allowlist',
        status: 'NOT_CHECKED',
        message: 'No scenario variation was requested for readiness.',
      });
    }

    checks.push({
      id: 'actor-authentication',
      status: 'NOT_CHECKED',
      message:
        'Actor authentication is checked only during an explicit confirmed live run, not ordinary readiness rendering.',
    });
    checks.push({
      id: 'fixture-resources',
      status: 'NOT_CHECKED',
      message:
        'Fixture resources are verified read-only by the run-scoped tenant-admin session after live run reservation.',
    });

    const activeStates = this.liveExecution ? await this.liveStateRepository().listActive() : [];
    const recoveryRequired = activeStates.find(
      (state) => state.checkpoint.status !== 'COMPLETED' && !this.liveRunTasks.has(state.runId),
    );
    if (this.activeLiveRunId) {
      block('concurrency', 'LIVE_RUN_IN_PROGRESS', 'Another live API run is already in progress.');
    } else if (recoveryRequired) {
      block(
        'concurrency',
        'LIVE_RUN_REQUIRES_RECOVERY',
        `Run ${recoveryRequired.runId} has a durable in-flight checkpoint and requires operator recovery before another live API run can start.`,
      );
    } else {
      pass('concurrency', 'No live API run is currently in progress.');
    }

    const blockedCheck = checks.find((check) => check.status === 'BLOCKED');
    const staticEligible = !blockedCheck;
    return executionReadinessV1Schema.parse({
      schemaVersion: 'nvs.execution-readiness/v1',
      environmentId: environment.id,
      runType: 'LIVE_API',
      ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
      ...(input.variationValues ? { variationValues: input.variationValues } : {}),
      verdict: blockedCheck ? 'BLOCKED' : 'PASS',
      confirmed: false,
      staticEligible,
      mutationEligible: false,
      gateEligible: false,
      checks,
      ...(blockedCheck
        ? {
            error: typedError(
              'ENVIRONMENT',
              blockedCheck.code ?? 'EXECUTION_READINESS_BLOCKED',
              blockedCheck.message,
            ),
          }
        : {}),
    });
  }

  async confirmExecutionReadiness(input: {
    environmentId: string;
    scenarioId?: string;
    variationValues?: Record<string, string>;
  }): Promise<ExecutionReadinessV1> {
    const staticReadiness = await this.executionReadiness(input);
    if (staticReadiness.verdict !== 'PASS') {
      return executionReadinessV1Schema.parse({
        ...staticReadiness,
        confirmed: true,
        staticEligible: false,
        mutationEligible: false,
      });
    }

    const environment = await this.getEnvironment(input.environmentId);
    const live = this.liveDependencies();
    const fixture = await live.fixtures.getForEnvironment(environment.id);
    const checks = staticReadiness.checks.filter(
      (check) => !['actor-authentication', 'fixture-resources'].includes(check.id),
    );
    const block = (id: string, code: string, message: string): void => {
      checks.push({ id, status: 'BLOCKED', code, message });
    };
    const pass = (id: string, message: string): void => {
      checks.push({ id, status: 'PASS', message });
    };

    if (!fixture?.enabled) {
      block(
        'fixture-resources',
        fixture ? 'NILES_INCIDENT_FIXTURE_DISABLED' : 'NILES_INCIDENT_FIXTURE_MISSING',
        'The configured NILES incident fixture is not available for confirmed preflight.',
      );
    } else {
      let sessions: Awaited<ReturnType<NvsCore['authenticateLiveActors']>> | undefined;
      try {
        sessions = await this.authenticateLiveActors(environment, fixture, 'confirmed_readiness');
        pass('actor-authentication', 'Required live actor profiles authenticated read-only.');
        const verifiedResources = await Promise.all([
          live.incidentAdapter.verifyResource({
            environment,
            session: sessions.tenantAdmin,
            tenantId: fixture.tenantId,
            kind: 'ASSIGNMENT_GROUP',
            id: fixture.resources.assignmentGroup.id,
            correlationId: this.liveCorrelation('confirmed_readiness_fixture_group'),
          }),
          live.incidentAdapter.verifyResource({
            environment,
            session: sessions.tenantAdmin,
            tenantId: fixture.tenantId,
            kind: 'SERVICE',
            id: fixture.resources.service.id,
            correlationId: this.liveCorrelation('confirmed_readiness_fixture_service'),
          }),
          ...(fixture.resources.offering
            ? [
                live.incidentAdapter.verifyResource({
                  environment,
                  session: sessions.tenantAdmin,
                  tenantId: fixture.tenantId,
                  kind: 'OFFERING' as const,
                  id: fixture.resources.offering.id,
                  correlationId: this.liveCorrelation('confirmed_readiness_fixture_offering'),
                }),
              ]
            : []),
          ...(fixture.resources.configurationItem
            ? [
                live.incidentAdapter.verifyResource({
                  environment,
                  session: sessions.tenantAdmin,
                  tenantId: fixture.tenantId,
                  kind: 'CI' as const,
                  id: fixture.resources.configurationItem.id,
                  correlationId: this.liveCorrelation('confirmed_readiness_fixture_ci'),
                }),
              ]
            : []),
        ]);
        const verifiedOffering = verifiedResources.find(
          (resource) => resource.id === fixture.resources.offering?.id,
        );
        if (fixture.resources.offering && !verifiedOffering?.serviceId) {
          block(
            'fixture-resources',
            'NILES_OFFERING_SERVICE_UNVERIFIED',
            'The configured service offering response did not expose a serviceId for compatibility verification.',
          );
        } else if (
          fixture.resources.offering &&
          verifiedOffering?.serviceId !== fixture.resources.service.id
        ) {
          block(
            'fixture-resources',
            'NILES_OFFERING_SERVICE_MISMATCH',
            'The configured service offering does not belong to the configured CMDB service.',
          );
        } else {
          pass(
            'fixture-resources',
            fixture.resources.sla.policyRef
              ? 'Required fixture resources were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.'
              : 'Required fixture resources were verified read-only.',
          );
        }
      } catch (error) {
        const typed = safeLiveError(error);
        if (!checks.some((check) => check.id === 'actor-authentication')) {
          block('actor-authentication', typed.code, typed.message);
        } else {
          block('fixture-resources', typed.code, typed.message);
        }
      } finally {
        sessions?.destroy();
      }
    }

    const blockedCheck = checks.find((check) => check.status === 'BLOCKED');
    return executionReadinessV1Schema.parse({
      schemaVersion: 'nvs.execution-readiness/v1',
      environmentId: environment.id,
      runType: 'LIVE_API',
      ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
      ...(input.variationValues ? { variationValues: input.variationValues } : {}),
      confirmed: true,
      staticEligible: true,
      verdict: blockedCheck ? 'BLOCKED' : 'PASS',
      mutationEligible: !blockedCheck,
      gateEligible: false,
      checks,
      ...(blockedCheck
        ? {
            error: typedError(
              'ENVIRONMENT',
              blockedCheck.code ?? 'EXECUTION_READINESS_BLOCKED',
              blockedCheck.message,
            ),
          }
        : {}),
    });
  }

  listScenarios(): Promise<BusinessBlueprintV1[]> {
    return this.scenarios.list();
  }

  async getScenario(id: string): Promise<BusinessBlueprintV1> {
    const scenario = await this.scenarios.get(id);
    if (!scenario) {
      throw new Error(`Scenario "${id}" was not found.`);
    }
    return scenario;
  }

  async compileScenario(
    id: string,
    variationValues: Record<string, string> = {},
  ): Promise<ExecutablePlanV1> {
    return compileBlueprint(await this.getScenario(id), variationValues);
  }

  private async prepareLiveApiRun(input: LiveApiRunInput): Promise<{
    environment: EnvironmentDefinitionV1;
    plan: ExecutablePlanV1;
    fixture: NilesIncidentFixtureV1;
  }> {
    const environment = await this.getEnvironment(input.environmentId);
    enforceEnvironmentOperationPolicy(environment, 'MUTATING');
    if (!input.confirmRealMutation) {
      throw new LiveRunBlockedError(
        'REAL_MUTATION_CONFIRMATION_REQUIRED',
        'Live API runs require confirmRealMutation: true.',
      );
    }

    const plan = await this.compileScenario(input.scenarioId, input.variationValues ?? {});
    const readiness = await this.executionReadiness({
      environmentId: environment.id,
      scenarioId: plan.scenario.id,
      variationValues: plan.variationValues,
    });
    if (readiness.verdict !== 'PASS') {
      const error = readiness.error;
      throw new LiveRunBlockedError(
        error?.code ?? 'EXECUTION_READINESS_BLOCKED',
        error?.message ?? 'Live API execution readiness is blocked.',
        error?.category === 'SCENARIO_CONTRACT' ? 'SCENARIO_CONTRACT' : 'ENVIRONMENT',
        error?.retryable ?? false,
      );
    }
    if (this.activeLiveRunId) {
      throw new LiveRunBlockedError(
        'LIVE_RUN_IN_PROGRESS',
        'Another live API run is already in progress.',
      );
    }
    this.activeLiveRunId = input.runId;

    try {
      const live = this.liveDependencies();
      const fixture = await live.fixtures.getForEnvironment(environment.id);
      if (!fixture?.enabled) {
        throw new LiveRunBlockedError(
          fixture ? 'NILES_INCIDENT_FIXTURE_DISABLED' : 'NILES_INCIDENT_FIXTURE_MISSING',
          'A live NILES incident fixture is not enabled for this environment.',
        );
      }
      return { environment, plan, fixture };
    } catch (error) {
      if (this.activeLiveRunId === input.runId) {
        this.activeLiveRunId = undefined;
      }
      throw error;
    }
  }

  private async saveLiveState(
    state: LiveRunState,
    status: LiveRunCheckpointV1['status'] = state.checkpoint.status,
  ): Promise<LiveRunState> {
    const checkpoint = liveRunCheckpointV1Schema.parse({
      ...state.checkpoint,
      status,
      incidentId: state.resourceInventory.incident?.id ?? state.checkpoint.incidentId,
      completedStepIds: state.observations
        .filter((observation) => observation.status === 'PASS')
        .map((observation) => observation.stepId),
      updatedAt: this.liveClock()(),
    });
    const nextState = { ...state, checkpoint };
    try {
      await this.liveStateRepository().save(nextState);
    } catch (error) {
      throw new LiveStatePersistenceError(error);
    }
    return nextState;
  }

  private initialLiveInventory(
    input: LiveApiRunInput,
    environment: EnvironmentDefinitionV1,
    plan: ExecutablePlanV1,
    fixture: NilesIncidentFixtureV1,
    now: string,
  ): ResourceInventoryV1 {
    return resourceInventoryV1Schema.parse({
      schemaVersion: 'nvs.resource-inventory/v1',
      runId: input.runId,
      environmentId: environment.id,
      tenantId: fixture.tenantId,
      scenario: plan.scenario,
      createdAt: now,
      createdBy: {
        semanticActorId: 'requester',
        operationalActorId: 'service-desk-agent',
      },
      resources: [
        { kind: 'TENANT', id: fixture.tenantId, disposition: 'VERIFIED_EXISTING' },
        {
          kind: 'ASSIGNMENT_GROUP',
          id: fixture.resources.assignmentGroup.id,
          label: fixture.resources.assignmentGroup.label,
          disposition: 'VERIFIED_EXISTING',
        },
        {
          kind: 'SERVICE',
          id: fixture.resources.service.id,
          label: fixture.resources.service.label,
          disposition: 'VERIFIED_EXISTING',
        },
        ...(fixture.resources.offering
          ? [
              {
                kind: 'OFFERING' as const,
                id: fixture.resources.offering.id,
                label: fixture.resources.offering.label,
                disposition: 'VERIFIED_EXISTING' as const,
              },
            ]
          : []),
        ...(fixture.resources.configurationItem
          ? [
              {
                kind: 'CI' as const,
                id: fixture.resources.configurationItem.id,
                label: fixture.resources.configurationItem.label,
                disposition: 'VERIFIED_EXISTING' as const,
              },
            ]
          : []),
      ],
      updatedAt: now,
    });
  }

  private async prepareLiveState(
    input: LiveApiRunInput,
    environment: EnvironmentDefinitionV1,
    plan: ExecutablePlanV1,
    fixture: NilesIncidentFixtureV1,
  ): Promise<LiveRunState> {
    await this.reserveRunId(input.runId);
    const state: LiveRunState = {
      runId: input.runId,
      plan,
      resourceInventory: this.initialLiveInventory(input, environment, plan, fixture, input.now),
      observations: [],
      checkpoint: liveRunCheckpointV1Schema.parse({
        schemaVersion: 'nvs.live-run-checkpoint/v1',
        runId: input.runId,
        environmentId: environment.id,
        fixtureId: fixture.id,
        status: 'PREPARED',
        completedStepIds: [],
        cleanup: { attempted: false, status: 'NOT_REQUIRED' },
        updatedAt: input.now,
      }),
    };
    await this.liveStateRepository().reserve(state);
    return state;
  }

  async startLiveApiRun(input: LiveApiRunInput): Promise<LiveRunAccepted> {
    const prepared = await this.prepareLiveApiRun(input);
    try {
      await this.prepareLiveState(input, prepared.environment, prepared.plan, prepared.fixture);
    } catch (error) {
      if (this.activeLiveRunId === input.runId) {
        this.activeLiveRunId = undefined;
      }
      throw error;
    }

    this.scheduleLiveRun(input.runId, () =>
      this.executePreparedLiveApiRun(input, prepared.environment, prepared.plan, prepared.fixture),
    );
    return {
      schemaVersion: 'nvs.live-run-accepted/v1',
      runId: input.runId,
      status: 'ACCEPTED',
    };
  }

  async createLiveApiRun(input: LiveApiRunInput): Promise<RunRecordV2> {
    const prepared = await this.prepareLiveApiRun(input);
    try {
      await this.prepareLiveState(input, prepared.environment, prepared.plan, prepared.fixture);
      return await this.executePreparedLiveApiRun(
        input,
        prepared.environment,
        prepared.plan,
        prepared.fixture,
      );
    } catch (error) {
      if (this.activeLiveRunId === input.runId) {
        this.activeLiveRunId = undefined;
      }
      throw error;
    }
  }

  private async executePreparedLiveApiRun(
    input: LiveApiRunInput,
    environment: EnvironmentDefinitionV1,
    plan: ExecutablePlanV1,
    fixture: NilesIncidentFixtureV1,
  ): Promise<RunRecordV2> {
    this.activeLiveRunId = input.runId;
    const live = this.liveDependencies();
    const clock = this.liveClock();
    const createdAt = input.now;
    const sanitization = {
      applied: true,
      redactedFields: ['authorization', 'cookie', 'password', 'secret', 'token', 'email'],
      patterns: ['bearer-credential', 'url-credential', 'email-address'],
    };
    const evidenceEntries = [
      {
        id: 'run-record',
        kind: 'RUN' as const,
        path: `runs/${input.runId}/run.json`,
        mediaType: 'application/json',
      },
      {
        id: 'compiled-plan',
        kind: 'PLAN' as const,
        path: `runs/${input.runId}/plan.json`,
        mediaType: 'application/json',
      },
      {
        id: 'evidence-manifest',
        kind: 'MANIFEST' as const,
        path: `runs/${input.runId}/evidence.json`,
        mediaType: 'application/json',
      },
      {
        id: 'resource-inventory',
        kind: 'OBSERVATION' as const,
        path: `runs/${input.runId}/inventory.json`,
        mediaType: 'application/json',
      },
      {
        id: 'step-observations',
        kind: 'OBSERVATION' as const,
        path: `runs/${input.runId}/observations.json`,
        mediaType: 'application/json',
      },
      {
        id: 'live-checkpoint',
        kind: 'OBSERVATION' as const,
        path: `runs/${input.runId}/checkpoint.json`,
        mediaType: 'application/json',
      },
    ];
    const observations: StepObservationV1[] = [];
    let incident: NilesIncidentRecord | undefined;
    let cleanupStatus: RunRecordV2['cleanup']['status'] = 'UNKNOWN';
    let cleanupPolicy: RunRecordV2['cleanup']['policy'] = 'RETAIN_FOR_DIAGNOSIS';
    let cleanupDetails = 'Live run did not complete cleanup classification.';
    let runError: TypedError | undefined;
    let cleanupError: TypedError | undefined;
    let sessions:
      | {
          requester: ActorSession;
          serviceDesk: ActorSession;
          incidentManager: ActorSession;
          tenantAdmin: ActorSession;
          destroy: () => void;
        }
      | undefined;

    const baseInventory = (): ResourceInventoryV1 =>
      resourceInventoryV1Schema.parse({
        schemaVersion: 'nvs.resource-inventory/v1',
        runId: input.runId,
        environmentId: environment.id,
        tenantId: fixture.tenantId,
        scenario: plan.scenario,
        createdAt,
        createdBy: {
          semanticActorId: 'requester',
          operationalActorId: 'service-desk-agent',
        },
        ...(incident
          ? {
              incident: {
                id: incident.id,
                ...(incident.number ? { number: incident.number } : {}),
                ...(incident.status ? { status: incident.status } : {}),
                disposition:
                  incident.status === 'closed'
                    ? 'RETAINED_CLOSED'
                    : incident.status === 'resolved'
                      ? 'RESOLVED'
                      : 'UPDATED',
              },
            }
          : {}),
        resources: [
          { kind: 'TENANT', id: fixture.tenantId, disposition: 'VERIFIED_EXISTING' },
          {
            kind: 'ASSIGNMENT_GROUP',
            id: fixture.resources.assignmentGroup.id,
            label: fixture.resources.assignmentGroup.label,
            disposition: 'VERIFIED_EXISTING',
          },
          {
            kind: 'SERVICE',
            id: fixture.resources.service.id,
            label: fixture.resources.service.label,
            disposition: 'VERIFIED_EXISTING',
          },
          ...(fixture.resources.offering
            ? [
                {
                  kind: 'OFFERING' as const,
                  id: fixture.resources.offering.id,
                  label: fixture.resources.offering.label,
                  disposition: 'VERIFIED_EXISTING' as const,
                },
              ]
            : []),
          ...(fixture.resources.configurationItem
            ? [
                {
                  kind: 'CI' as const,
                  id: fixture.resources.configurationItem.id,
                  label: fixture.resources.configurationItem.label,
                  disposition: 'VERIFIED_EXISTING' as const,
                },
              ]
            : []),
          ...(incident
            ? [
                {
                  kind: 'INCIDENT' as const,
                  id: incident.id,
                  label: incident.number,
                  disposition:
                    incident.status === 'closed'
                      ? ('RETAINED_CLOSED' as const)
                      : incident.status === 'resolved'
                        ? ('RESOLVED' as const)
                        : ('UPDATED' as const),
                },
              ]
            : []),
        ],
        updatedAt: clock(),
      });

    let liveState =
      (await this.liveStateRepository().get(input.runId)) ??
      ({
        runId: input.runId,
        plan,
        resourceInventory: baseInventory(),
        observations,
        checkpoint: liveRunCheckpointV1Schema.parse({
          schemaVersion: 'nvs.live-run-checkpoint/v1',
          runId: input.runId,
          environmentId: environment.id,
          fixtureId: fixture.id,
          status: 'PREPARED',
          completedStepIds: [],
          cleanup: { attempted: false, status: 'NOT_REQUIRED' },
          updatedAt: createdAt,
        }),
      } satisfies LiveRunState);

    const persistLiveState = async (
      status: LiveRunCheckpointV1['status'] = 'RUNNING',
    ): Promise<void> => {
      liveState = await this.saveLiveState(
        {
          ...liveState,
          plan,
          resourceInventory: baseInventory(),
          observations: [...observations],
        },
        status,
      );
    };

    await persistLiveState('RUNNING');

    const observe = async (
      step: ExecutablePlanV1['steps'][number],
      operation: (
        correlationId: string,
        actualActorId: string,
        actorProfileId: string,
      ) => Promise<LiveObservationOutcome>,
      actor: ActorSession,
      actualActorId: string,
    ): Promise<void> => {
      const startedAt = clock();
      const correlationId = this.liveCorrelation(`${input.runId}_${step.sequence}_${step.action}`);
      try {
        const outcome = normalizeObservationOutcome(
          await operation(correlationId, actualActorId, actor.actorProfileId),
        );
        observations.push(
          stepObservationV1Schema.parse({
            schemaVersion: 'nvs.step-observation/v1',
            id: `obs_${step.sequence}_${step.source.blueprintStepId}`.slice(0, 96),
            runId: input.runId,
            stepId: step.id,
            sourceStepId: step.source.blueprintStepId,
            sequence: step.sequence,
            actorId: actualActorId,
            semanticActorId: step.actorId,
            actorProfileId: actor.actorProfileId,
            action: step.action,
            status: outcome.status,
            startedAt,
            completedAt: clock(),
            correlationId,
            evidence: outcome.evidence,
          }),
        );
        await persistLiveState('RUNNING');
      } catch (error) {
        if (error instanceof LiveStatePersistenceError) {
          throw error;
        }
        const typed = safeLiveError(error);
        observations.push(
          stepObservationV1Schema.parse({
            schemaVersion: 'nvs.step-observation/v1',
            id: `obs_${step.sequence}_${step.source.blueprintStepId}`.slice(0, 96),
            runId: input.runId,
            stepId: step.id,
            sourceStepId: step.source.blueprintStepId,
            sequence: step.sequence,
            actorId: actualActorId,
            semanticActorId: step.actorId,
            actorProfileId: actor.actorProfileId,
            action: step.action,
            status: classifyError(typed),
            startedAt,
            completedAt: clock(),
            correlationId,
            evidence: errorTransportEvidence(error),
            error: typed,
          }),
        );
        await persistLiveState('RUNNING');
        throw new LiveStepError(typed);
      }
    };

    try {
      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);
      const verifiedResources = await Promise.all([
        live.incidentAdapter.verifyResource({
          environment,
          session: sessions.tenantAdmin,
          tenantId: fixture.tenantId,
          kind: 'ASSIGNMENT_GROUP',
          id: fixture.resources.assignmentGroup.id,
          correlationId: this.liveCorrelation(`${input.runId}_fixture_group`),
        }),
        live.incidentAdapter.verifyResource({
          environment,
          session: sessions.tenantAdmin,
          tenantId: fixture.tenantId,
          kind: 'SERVICE',
          id: fixture.resources.service.id,
          correlationId: this.liveCorrelation(`${input.runId}_fixture_service`),
        }),
        ...(fixture.resources.offering
          ? [
              live.incidentAdapter.verifyResource({
                environment,
                session: sessions.tenantAdmin,
                tenantId: fixture.tenantId,
                kind: 'OFFERING' as const,
                id: fixture.resources.offering.id,
                correlationId: this.liveCorrelation(`${input.runId}_fixture_offering`),
              }),
            ]
          : []),
        ...(fixture.resources.configurationItem
          ? [
              live.incidentAdapter.verifyResource({
                environment,
                session: sessions.tenantAdmin,
                tenantId: fixture.tenantId,
                kind: 'CI' as const,
                id: fixture.resources.configurationItem.id,
                correlationId: this.liveCorrelation(`${input.runId}_fixture_ci`),
              }),
            ]
          : []),
      ]);
      const verifiedOffering = verifiedResources.find(
        (resource) => resource.id === fixture.resources.offering?.id,
      );
      const verifiedOfferingServiceId = verifiedOffering?.serviceId;
      if (fixture.resources.offering && !verifiedOfferingServiceId) {
        throw new LiveRunBlockedError(
          'NILES_OFFERING_SERVICE_UNVERIFIED',
          'The configured service offering response did not expose a serviceId for compatibility verification.',
          'ENVIRONMENT',
        );
      }
      if (
        fixture.resources.offering &&
        verifiedOfferingServiceId !== fixture.resources.service.id
      ) {
        throw new LiveRunBlockedError(
          'NILES_OFFERING_SERVICE_MISMATCH',
          'The configured service offering does not belong to the configured CMDB service.',
          'ENVIRONMENT',
        );
      }

      for (const step of plan.steps) {
        const actorContext =
          step.action === 'evidence.read_audit'
            ? { actorId: 'incident-manager', session: sessions.incidentManager }
            : step.action === 'incident.close'
              ? { actorId: 'requester', session: sessions.requester }
              : { actorId: 'service-desk-agent', session: sessions.serviceDesk };
        await observe(
          step,
          async (correlationId) => {
            switch (step.action) {
              case 'incident.report': {
                incident = await live.incidentAdapter.createIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  correlationId,
                  runId: input.runId,
                  runNamespacePrefix: fixture.runNamespacePrefix,
                  requesterUserId: sessions!.requester.userId,
                  assignmentGroupId: fixture.resources.assignmentGroup.id,
                  serviceId: fixture.resources.service.id,
                  ...(fixture.resources.offering
                    ? { offeringId: fixture.resources.offering.id }
                    : {}),
                  impact: fixture.resources.impact,
                  urgency: fixture.resources.urgency,
                });
                requireLiveAssertion(
                  Boolean(incident.id),
                  'INCIDENT_ID_MISSING',
                  'NILES did not return a created incident identity.',
                );
                await persistLiveState('RUNNING');
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  incidentNumber: incident.number ?? null,
                  semanticReporter: 'requester',
                  operationalWriter: 'service-desk-agent',
                };
              }
              case 'incident.triage': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before triage.',
                    ),
                  );
                incident = await live.incidentAdapter.readIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationId,
                });
                if (fixture.resources.expectedPriority) {
                  requireLiveAssertion(
                    incident.priority === fixture.resources.expectedPriority,
                    'INCIDENT_PRIORITY_MISMATCH',
                    'The observed incident priority does not match the configured impact and urgency expectation.',
                  );
                }
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                  priority: incident.priority ?? null,
                };
              }
              case 'incident.assign': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before assignment.',
                    ),
                  );
                incident = await live.incidentAdapter.assignIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  assignmentGroupId: fixture.resources.assignmentGroup.id,
                  correlationId,
                });
                requireLiveAssertion(
                  incident.assignmentGroupId === fixture.resources.assignmentGroup.id,
                  'INCIDENT_ASSIGNMENT_GROUP_MISMATCH',
                  'The incident assignment group does not match the configured fixture.',
                );
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  assignmentGroupId: incident.assignmentGroupId ?? null,
                };
              }
              case 'incident.take_ownership': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before ownership.',
                    ),
                  );
                incident = await live.incidentAdapter.takeOwnership({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationId,
                });
                requireLiveAssertion(
                  incident.assignedTo === sessions!.serviceDesk.userId,
                  'INCIDENT_OWNER_MISMATCH',
                  'The acting Service Desk user did not become the incident owner.',
                );
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  assignedToCurrentActor: incident.assignedTo === sessions!.serviceDesk.userId,
                  status: incident.status ?? null,
                };
              }
              case 'incident.start_work': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before work starts.',
                    ),
                  );
                if (incident.status !== 'in_progress') {
                  incident = await live.incidentAdapter.startWork({
                    environment,
                    session: sessions!.serviceDesk,
                    tenantId: fixture.tenantId,
                    incidentId: incident.id,
                    correlationId,
                  });
                }
                requireLiveAssertion(
                  incident.status === 'in_progress',
                  'INCIDENT_NOT_IN_PROGRESS',
                  'The incident did not enter in-progress work state.',
                );
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                  supportedStateField: 'status',
                };
              }
              case 'incident.link_service_context': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before service context linkage.',
                    ),
                  );
                let addAffectedCiTransport: NilesTransportEvidence | undefined;
                let listAffectedCiTransport: NilesTransportEvidence | undefined;
                if (fixture.resources.configurationItem) {
                  addAffectedCiTransport =
                    (await live.incidentAdapter.addAffectedCi({
                      environment,
                      session: sessions!.serviceDesk,
                      tenantId: fixture.tenantId,
                      incidentId: incident.id,
                      ciId: fixture.resources.configurationItem.id,
                      relationshipType: fixture.resources.affectedCi.relationshipType,
                      ...(fixture.resources.affectedCi.impactScope
                        ? { impactScope: fixture.resources.affectedCi.impactScope }
                        : {}),
                      correlationId,
                    })) ?? undefined;
                  const affectedCis = await live.incidentAdapter
                    .listAffectedCis({
                      environment,
                      session: sessions!.serviceDesk,
                      tenantId: fixture.tenantId,
                      incidentId: incident.id,
                      correlationId,
                    })
                    .catch((error: Error) => {
                      throw attachOperationEvidence(error, [addAffectedCiTransport]);
                    });
                  listAffectedCiTransport = affectedCis.transport;
                  requireLiveAssertion(
                    affectedCis.items.some(
                      (candidate) => candidate.ciId === fixture.resources.configurationItem?.id,
                    ),
                    'AFFECTED_CI_LINK_NOT_OBSERVED',
                    'The affected CI relation was not observable after creation.',
                  );
                }
                return {
                  ...transportObservation(addAffectedCiTransport),
                  ...operationsEvidence([addAffectedCiTransport, listAffectedCiTransport]),
                  incidentId: incident.id,
                  serviceId: fixture.resources.service.id,
                  offeringId: fixture.resources.offering?.id ?? null,
                  ciId: fixture.resources.configurationItem?.id ?? null,
                };
              }
              case 'sla.read_summary': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before SLA observation.',
                    ),
                  );
                const summary = await live.incidentAdapter.readSlaSummary({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationId,
                });
                const observedObjectiveTypes = observedSlaObjectiveTypes(summary);
                const requiredObjectiveTypes = fixture.resources.sla.objectiveTypes;
                const phase =
                  step.source.blueprintStepId === 'observe-held-sla' ? 'held' : 'active';
                if (fixture.resources.sla.required) {
                  assertRequiredSlaObjectives(summary, requiredObjectiveTypes);
                  assertObservedSlaPolicy(summary, fixture.resources.sla.policyRef);
                  if (phase === 'active') {
                    requireLiveAssertion(
                      summary.records.some((record) => isRunningSlaStatus(record.status)),
                      'SLA_ACTIVE_POSTURE_NOT_OBSERVED',
                      'Required active SLA running posture was not observable before hold.',
                    );
                  } else {
                    requireLiveAssertion(
                      summary.records.some(isPausedSlaRecord),
                      'SLA_PAUSE_NOT_OBSERVED',
                      'Required held SLA posture was not observable while the incident was on hold.',
                    );
                  }
                } else if (summary.records.length === 0) {
                  return {
                    status: 'NOT_OBSERVED',
                    evidence: {
                      ...transportObservation(summary.transport),
                      incidentId: incident.id,
                      slaRecords: 0,
                      required: false,
                    },
                  };
                }
                return {
                  ...transportObservation(summary.transport),
                  incidentId: incident.id,
                  slaRecords: summary.records.length,
                  slaPhase: phase,
                  slaPolicyRef: fixture.resources.sla.policyRef ?? null,
                  slaPolicyVerification: fixture.resources.sla.policyRef
                    ? 'DEFERRED_NO_CONFIRMED_READ_CONTRACT'
                    : 'NOT_CONFIGURED',
                  responseObjectiveObserved: observedObjectiveTypes.has('response'),
                  resolutionObjectiveObserved: observedObjectiveTypes.has('resolution'),
                };
              }
              case 'incident.hold': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before hold.',
                    ),
                  );
                incident = await live.incidentAdapter.holdIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  pendingReason: fixture.resources.hold.pendingReason,
                  pendingReasonDetail: fixture.resources.hold.pendingReasonDetail,
                  correlationId,
                });
                requireLiveAssertion(
                  incident.status === 'on_hold',
                  'INCIDENT_NOT_ON_HOLD',
                  'The incident did not enter on-hold state.',
                );
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                  supportedStateField: 'status',
                };
              }
              case 'incident.resume': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before resume.',
                    ),
                  );
                incident = await live.incidentAdapter.resumeIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationId,
                });
                requireLiveAssertion(
                  incident.status === 'in_progress',
                  'INCIDENT_NOT_RESUMED',
                  'The incident did not resume to in-progress state.',
                );
                const resumedSla = await live.incidentAdapter
                  .readSlaSummary({
                    environment,
                    session: sessions!.serviceDesk,
                    tenantId: fixture.tenantId,
                    incidentId: incident.id,
                    correlationId,
                  })
                  .catch((error: Error) => {
                    throw attachOperationEvidence(error, [incident!.transport]);
                  });
                if (fixture.resources.sla.required) {
                  assertRequiredSlaObjectives(resumedSla, fixture.resources.sla.objectiveTypes);
                  assertObservedSlaPolicy(resumedSla, fixture.resources.sla.policyRef);
                  const stillPaused = resumedSla.records.some(isPausedSlaRecord);
                  requireLiveAssertion(
                    !stillPaused,
                    'SLA_NOT_RESUMED',
                    'SLA posture still appeared paused after incident resume.',
                  );
                }
                return {
                  ...transportObservation(incident.transport),
                  ...operationsEvidence([incident.transport, resumedSla.transport]),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                  supportedStateField: 'status',
                  slaResumedObserved: resumedSla.records.length > 0,
                  responseObjectiveObserved: observedSlaObjectiveTypes(resumedSla).has('response'),
                  resolutionObjectiveObserved:
                    observedSlaObjectiveTypes(resumedSla).has('resolution'),
                };
              }
              case 'incident.resolve': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before resolve.',
                    ),
                  );
                incident = await live.incidentAdapter.resolveIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  resolutionNotes: fixture.resources.resolutionNotes,
                  correlationId,
                });
                requireLiveAssertion(
                  incident.status === 'resolved',
                  'INCIDENT_NOT_RESOLVED',
                  'The incident did not reach resolved state.',
                );
                const resolvedSla = await live.incidentAdapter
                  .readSlaSummary({
                    environment,
                    session: sessions!.serviceDesk,
                    tenantId: fixture.tenantId,
                    incidentId: incident.id,
                    correlationId,
                  })
                  .catch((error: Error) => {
                    throw attachOperationEvidence(error, [incident!.transport]);
                  });
                if (fixture.resources.sla.required) {
                  assertRequiredSlaObjectives(resolvedSla, fixture.resources.sla.objectiveTypes);
                  assertObservedSlaPolicy(resolvedSla, fixture.resources.sla.policyRef);
                  const resolutionStopped = resolvedSla.records.some(isStoppedResolutionSlaRecord);
                  requireLiveAssertion(
                    resolutionStopped,
                    'SLA_RESOLUTION_STOP_NOT_OBSERVED',
                    'Required resolution SLA stop posture was not observable after resolve.',
                  );
                }
                return {
                  ...transportObservation(incident.transport),
                  ...operationsEvidence([incident.transport, resolvedSla.transport]),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                  supportedStateField: 'status',
                  slaResolvedObserved: resolvedSla.records.length > 0,
                  responseObjectiveObserved: observedSlaObjectiveTypes(resolvedSla).has('response'),
                  resolutionObjectiveObserved:
                    observedSlaObjectiveTypes(resolvedSla).has('resolution'),
                };
              }
              case 'evidence.read_audit': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before audit review.',
                    ),
                  );
                const reviewedIncident = await live.incidentAdapter.readIncident({
                  environment,
                  session: sessions!.incidentManager,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationId,
                });
                const journal = await live.incidentAdapter
                  .readJournalSummary({
                    environment,
                    session: sessions!.incidentManager,
                    tenantId: fixture.tenantId,
                    incidentId: incident.id,
                    correlationId,
                  })
                  .catch((error: Error) => {
                    throw attachOperationEvidence(error, [reviewedIncident.transport]);
                  });
                incident = reviewedIncident;
                if (journal.count === 0) {
                  throw new LiveStepError(
                    typedError(
                      'ENVIRONMENT',
                      'AUDIT_JOURNAL_NOT_OBSERVED',
                      'Required audit or journal evidence was not observable for the run-owned incident.',
                    ),
                  );
                }
                const requiredAuditActions: JournalLifecycleAction[] = [
                  'hold',
                  'resume',
                  'resolve',
                ];
                const missingActions = requiredAuditActions.filter(
                  (action) =>
                    !journal.entries?.some((entry) =>
                      hasStableJournalAttribution(entry, action, sessions!.serviceDesk.userId),
                    ),
                );
                if (missingActions.length > 0) {
                  throw new LiveStepError(
                    typedError(
                      'ENVIRONMENT',
                      'AUDIT_ACTION_ATTRIBUTION_UNAVAILABLE',
                      `Required journal lifecycle attribution was unavailable from stable public fields: ${missingActions.join(', ')}.`,
                    ),
                  );
                }
                return {
                  ...transportObservation(reviewedIncident.transport ?? journal.transport),
                  ...operationsEvidence([reviewedIncident.transport, journal.transport]),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                  journalCount: journal.count,
                  journalEntries: journal.entries?.length ?? journal.count,
                };
              }
              case 'incident.close': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before close.',
                    ),
                  );
                if (!fixture.resources.closeAuthority.requesterMustHaveIncidentWrite) {
                  throw new LiveStepError(
                    typedError(
                      'ENVIRONMENT',
                      'NILES_CLOSE_AUTHORITY_UNSATISFIABLE',
                      'NILES requires requester or opening-user close authority, but the configured requester profile does not have the required write permission.',
                    ),
                  );
                }
                incident = await live.incidentAdapter.closeIncident({
                  environment,
                  session: sessions!.requester,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  closureNote: 'NVS synthetic requester confirms service restoration.',
                  correlationId,
                });
                requireLiveAssertion(
                  incident.status === 'closed',
                  'INCIDENT_NOT_CLOSED',
                  'The incident did not reach closed state.',
                );
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  status: incident.status ?? null,
                };
              }
              default:
                throw new LiveStepError(
                  typedError(
                    'SCENARIO_CONTRACT',
                    'LIVE_ACTION_NOT_IMPLEMENTED',
                    `Live API execution does not support action ${step.action}.`,
                  ),
                );
            }
          },
          actorContext.session,
          actorContext.actorId,
        );
      }

      cleanupStatus = 'RETAINED_BY_POLICY';
      cleanupPolicy = 'RETAIN_CLOSED';
      cleanupDetails = 'Closed run-owned incident retained by policy for release evidence.';
    } catch (error) {
      if (error instanceof LiveStatePersistenceError) {
        throw error;
      }
      runError = safeLiveError(error);
      const failureVerdict = classifyError(runError);
      if (
        incident &&
        incident.status !== 'closed' &&
        sessions &&
        failureVerdict === 'BLOCKED' &&
        fixture.cleanup.onBlockedBeforeClose === 'DELETE_IF_RUN_OWNED'
      ) {
        cleanupPolicy = fixture.cleanup.onBlockedBeforeClose;
        try {
          await live.incidentAdapter.softDeleteIncident({
            environment,
            session: sessions.serviceDesk,
            tenantId: fixture.tenantId,
            incidentId: incident.id,
            correlationId: this.liveCorrelation(`${input.runId}_cleanup_delete`),
          });
          const deleted = await live.incidentAdapter.verifyIncidentDeleted({
            environment,
            session: sessions.serviceDesk,
            tenantId: fixture.tenantId,
            incidentId: incident.id,
            correlationId: this.liveCorrelation(`${input.runId}_cleanup_verify`),
          });
          cleanupStatus = deleted ? 'CLEAN' : 'PARTIAL';
          cleanupDetails = deleted
            ? 'Run-owned pre-close incident was soft-deleted after BLOCKED live execution.'
            : 'Run-owned incident delete was attempted but absence could not be verified.';
          if (!deleted) {
            cleanupError = typedError(
              'CLEANUP',
              'RUN_OWNED_CLEANUP_UNVERIFIED',
              'Run-owned incident delete was attempted but absence could not be verified.',
            );
          }
          if (deleted) {
            incident = {
              id: incident.id,
              ...(incident.number ? { number: incident.number } : {}),
            };
          }
        } catch {
          cleanupStatus = 'PARTIAL';
          cleanupDetails =
            'Run-owned incident delete was attempted after BLOCKED live execution but did not complete.';
          cleanupError = typedError(
            'CLEANUP',
            'RUN_OWNED_CLEANUP_FAILED',
            'Run-owned incident cleanup failed after BLOCKED live execution.',
          );
        }
      } else if (
        incident &&
        incident.status !== 'closed' &&
        !sessions &&
        failureVerdict === 'BLOCKED' &&
        fixture.cleanup.onBlockedBeforeClose === 'DELETE_IF_RUN_OWNED'
      ) {
        cleanupPolicy = fixture.cleanup.onBlockedBeforeClose;
        cleanupStatus = 'PARTIAL';
        cleanupDetails =
          'Run-owned incident cleanup was required after BLOCKED live execution but no live session was available.';
        cleanupError = typedError(
          'CLEANUP',
          'RUN_OWNED_CLEANUP_SESSION_UNAVAILABLE',
          'Run-owned incident cleanup could not run because no live session was available.',
        );
      } else if (incident) {
        cleanupPolicy = failureVerdict === 'FAIL' ? fixture.cleanup.onFail : 'RETAIN_FOR_DIAGNOSIS';
        cleanupStatus = 'RETAINED_BY_POLICY';
        cleanupDetails =
          failureVerdict === 'FAIL'
            ? 'Incident retained for diagnosis after live API assertion failure.'
            : 'Incident retained for diagnosis after live API blocker.';
      } else {
        cleanupPolicy =
          failureVerdict === 'FAIL' ? fixture.cleanup.onFail : fixture.cleanup.onBlockedBeforeClose;
        cleanupStatus = 'NOT_REQUIRED';
        cleanupDetails = 'No NILES incident was created before the live run ended.';
      }
    } finally {
      sessions?.destroy();
    }

    const inventory = baseInventory();
    const finalInventory =
      cleanupStatus === 'CLEAN' && incident
        ? resourceInventoryV1Schema.parse({
            ...inventory,
            incident: {
              id: incident.id,
              ...(incident.number ? { number: incident.number } : {}),
              disposition: 'DELETED',
            },
            resources: inventory.resources.map((resource) =>
              resource.kind === 'INCIDENT' ? { ...resource, disposition: 'DELETED' } : resource,
            ),
            updatedAt: clock(),
          })
        : inventory;
    const completedAt = clock();
    const stepResults = plan.steps.map((step) => {
      const observation = observations.find((candidate) => candidate.stepId === step.id);
      return {
        stepId: step.id,
        executionStatus: observation?.status ?? ('NOT_OBSERVED' as const),
        required: observation?.status === 'NOT_OBSERVED' ? false : true,
        ...(observation ? { observationId: observation.id } : {}),
        ...(observation?.error ? { error: observation.error } : {}),
      };
    });
    const verdict = runError
      ? classifyError(runError)
      : stepResults.every(
            (step) =>
              step.executionStatus === 'PASS' ||
              (step.executionStatus === 'NOT_OBSERVED' && !step.required),
          )
        ? 'PASS'
        : 'BLOCKED';
    const run = runRecordV2Schema.parse({
      schemaVersion: 'nvs.run/v2',
      runId: input.runId,
      runType: 'LIVE_API',
      status: 'COMPLETED',
      verdict,
      gateEligible: verdict === 'PASS',
      assuranceScope: 'LIVE_NILES_INCIDENT_API',
      environmentId: environment.id,
      scenario: plan.scenario,
      variationValues: plan.variationValues,
      planId: plan.id,
      fixtureId: fixture.id,
      ...(input.target ? { target: input.target } : {}),
      toolVersions: {
        nvs: '0.1.0',
        node: process.version,
        contracts: 'v2',
      },
      timestamps: { createdAt, completedAt },
      stepResults,
      ...(runError ? { error: runError } : {}),
      evidence: evidenceEntries,
      sanitization,
      cleanup: {
        status: cleanupStatus,
        policy: cleanupPolicy,
        details: cleanupDetails,
        ...(cleanupError ? { error: cleanupError } : {}),
      },
      resourceInventory: finalInventory,
    });
    const manifest = evidenceManifestV1Schema.parse({
      schemaVersion: 'nvs.evidence/v1',
      runId: input.runId,
      entries: evidenceEntries,
      sanitization,
      createdAt,
    });
    const completedCheckpoint = liveRunCheckpointV1Schema.parse({
      schemaVersion: 'nvs.live-run-checkpoint/v1',
      runId: input.runId,
      environmentId: environment.id,
      fixtureId: fixture.id,
      status: 'COMPLETED',
      ...(incident?.id ? { incidentId: incident.id } : {}),
      completedStepIds: observations
        .filter((observation) => observation.status === 'PASS')
        .map((observation) => observation.stepId),
      cleanup: { attempted: cleanupStatus !== 'NOT_REQUIRED', status: cleanupStatus },
      updatedAt: completedAt,
    });
    const finalizingCheckpoint = liveRunCheckpointV1Schema.parse({
      ...completedCheckpoint,
      status: 'FINALIZING',
    });
    await this.liveStateRepository().save({
      ...liveState,
      checkpoint: finalizingCheckpoint,
      resourceInventory: finalInventory,
      observations,
    });
    const saved = (await this.bundles.saveBundle({
      run,
      plan,
      evidenceManifest: manifest,
      resourceInventory: finalInventory,
      observations,
      checkpoint: completedCheckpoint,
    })) as RunRecordV2;
    const committed = await this.bundles.get(input.runId);
    const committedCheckpoint = await this.bundles.getLiveCheckpoint?.(input.runId);
    if (
      !committed ||
      committed.runType !== 'LIVE_API' ||
      committed.runId !== input.runId ||
      committedCheckpoint?.status !== 'COMPLETED'
    ) {
      throw new LiveStatePersistenceError(
        new Error('Committed live run bundle could not be verified after finalization.'),
      );
    }
    await this.liveStateRepository().complete(input.runId);
    if (this.activeLiveRunId === input.runId) {
      this.activeLiveRunId = undefined;
    }
    return saved;
  }

  async createCompileOnlyRun(input: CompileOnlyRunInput): Promise<RunRecordV1> {
    const environment = await this.getEnvironment(input.environmentId);
    enforceEnvironmentOperationPolicy(environment, 'COMPILE_ONLY');
    await this.reserveRunId(input.runId);
    const plan = await this.compileScenario(input.scenarioId, input.variationValues ?? {});
    const evidenceEntries = [
      {
        id: 'run-record',
        kind: 'RUN' as const,
        path: `runs/${input.runId}/run.json`,
        mediaType: 'application/json',
      },
      {
        id: 'compiled-plan',
        kind: 'PLAN' as const,
        path: `runs/${input.runId}/plan.json`,
        mediaType: 'application/json',
      },
      {
        id: 'evidence-manifest',
        kind: 'MANIFEST' as const,
        path: `runs/${input.runId}/evidence.json`,
        mediaType: 'application/json',
      },
    ];
    const sanitization = {
      applied: true,
      redactedFields: ['authorization', 'cookie', 'password', 'secret', 'token'],
      patterns: ['bearer-credential', 'url-credential'],
    };
    const manifest = evidenceManifestV1Schema.parse({
      schemaVersion: 'nvs.evidence/v1',
      runId: input.runId,
      entries: evidenceEntries,
      sanitization,
      createdAt: input.now,
    });
    const run = runRecordV1Schema.parse({
      schemaVersion: 'nvs.run/v1',
      runId: input.runId,
      runType: 'COMPILE_ONLY',
      status: 'COMPLETED',
      verdict: 'PASS',
      gateEligible: false,
      assuranceScope: 'COMPILATION_ONLY',
      environmentId: environment.id,
      scenario: plan.scenario,
      variationValues: plan.variationValues,
      planId: plan.id,
      ...(input.target ? { target: input.target } : {}),
      toolVersions: {
        nvs: '0.1.0',
        node: process.version,
        contracts: 'v1',
      },
      timestamps: {
        createdAt: input.now,
        completedAt: input.now,
      },
      stepResults: plan.steps.map((step) => ({
        stepId: step.id,
        compilationStatus: 'PASS' as const,
        executionStatus: 'NOT_EXECUTED' as const,
      })),
      evidence: evidenceEntries,
      sanitization,
      cleanup: { status: 'NOT_REQUIRED', details: 'Compile-only runs create no NILES records.' },
    });

    return runRecordV1Schema.parse(
      await this.bundles.saveBundle({ run, plan, evidenceManifest: manifest }),
    );
  }

  listRuns(): Promise<RunRecord[]> {
    return this.bundles.list();
  }

  async getRun(id: string): Promise<RunRecord> {
    const run = await this.bundles.get(id);
    if (!run) {
      throw new Error(`Run "${id}" was not found.`);
    }
    return run;
  }

  async getPlan(runId: string): Promise<ExecutablePlanV1> {
    const plan =
      (await this.bundles.getPlan(runId)) ?? (await this.liveStateRepository().get(runId))?.plan;
    if (!plan) {
      throw new Error(`Plan for run "${runId}" was not found.`);
    }
    return plan;
  }

  async getEvidence(runId: string): Promise<EvidenceManifestV1> {
    const evidence = await this.bundles.getEvidence(runId);
    if (!evidence) {
      throw new Error(`Evidence for run "${runId}" was not found.`);
    }
    return evidence;
  }

  async getRunProgress(runId: string): Promise<{
    schemaVersion: 'nvs.run-progress/v1';
    runId: string;
    status: RunRecord['status'] | 'PREPARED' | 'FINALIZING' | 'RECOVERY_REQUIRED';
    verdict: RunRecord['verdict'] | 'PENDING';
    observations: StepObservationV1[];
    checkpoint?: LiveRunCheckpointV1;
  }> {
    const run = await this.bundles.get(runId);
    if (run) {
      const observations = (await this.bundles.getStepObservations?.(runId)) ?? [];
      const checkpoint = await this.bundles.getLiveCheckpoint?.(runId);
      return {
        schemaVersion: 'nvs.run-progress/v1',
        runId,
        status: run.status,
        verdict: run.verdict,
        observations,
        ...(checkpoint ? { checkpoint } : {}),
      };
    }

    const state = await this.liveStateRepository().get(runId);
    if (!state) {
      throw new Error(`Run "${runId}" was not found.`);
    }
    const taskActive = this.liveRunTasks.has(runId) || this.activeLiveRunId === runId;
    const checkpoint =
      !taskActive && state.checkpoint.status !== 'COMPLETED'
        ? liveRunCheckpointV1Schema.parse({
            ...state.checkpoint,
            status: 'RECOVERY_REQUIRED',
            updatedAt: this.liveClock()(),
          })
        : state.checkpoint;
    return {
      schemaVersion: 'nvs.run-progress/v1',
      runId,
      status: checkpoint.status,
      verdict: checkpoint.status === 'RECOVERY_REQUIRED' ? 'BLOCKED' : 'PENDING',
      observations: state.observations,
      checkpoint,
    };
  }

  async listActiveLiveRuns(): Promise<
    Array<{
      schemaVersion: 'nvs.run-progress/v1';
      runId: string;
      status: RunRecord['status'] | 'PREPARED' | 'FINALIZING' | 'RECOVERY_REQUIRED';
      verdict: RunRecord['verdict'] | 'PENDING';
      observations: StepObservationV1[];
      checkpoint?: LiveRunCheckpointV1;
    }>
  > {
    const states = await this.liveStateRepository().listActive();
    return Promise.all(states.map((state) => this.getRunProgress(state.runId)));
  }

  async getResourceInventory(runId: string): Promise<ResourceInventoryV1> {
    const inventory =
      (await this.bundles.getResourceInventory?.(runId)) ??
      (await this.liveStateRepository().get(runId))?.resourceInventory;
    if (!inventory) {
      throw new Error(`Resource inventory for run "${runId}" was not found.`);
    }
    return inventory;
  }

  async coverage(): Promise<{
    summary: { cells: number; executed: number };
    cells: CoverageCell[];
  }> {
    const scenarios = await this.scenarios.list();
    const cells: CoverageCell[] = [];
    for (const scenario of scenarios) {
      for (const dimension of scenario.variationDimensions) {
        for (const value of dimension.values) {
          const plan = compileBlueprint(scenario, { [dimension.id]: value.id });
          cells.push({
            scenarioId: scenario.id,
            variation: `${dimension.id}=${value.id}`,
            actors: [...new Set(plan.steps.map((step) => step.actorId))].sort(),
            actions: [...new Set(plan.steps.map((step) => step.action))].sort(),
            assertionKinds: [
              ...new Set(
                plan.steps.flatMap((step) => step.assertions.map((assertion) => assertion.kind)),
              ),
            ].sort(),
            expectedOutcome: plan.expectedOutcome,
            status: 'DECLARED_COMPILED_NOT_EXECUTED',
          });
        }
      }
    }
    return { summary: { cells: cells.length, executed: 0 }, cells };
  }
}
