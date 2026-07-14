import { randomUUID } from 'node:crypto';
import {
  actorListV1Schema,
  actorReadinessV1Schema,
  authPreflightV1Schema,
  evidenceManifestV1Schema,
  runRecordV1Schema,
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
  type ExecutablePlanV1,
  type ProbeResultV1,
  type RunRecordV1,
  type TypedError,
} from '@nvs/contracts';
import { compileBlueprint, enforceEnvironmentOperationPolicy } from '@nvs/domain';

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
  run: RunRecordV1;
  plan: ExecutablePlanV1;
  evidenceManifest: EvidenceManifestV1;
}

export interface RunBundleRepository {
  saveBundle(bundle: RunBundle): Promise<RunRecordV1>;
  list(): Promise<RunRecordV1[]>;
  get(id: string): Promise<RunRecordV1 | undefined>;
  getPlan(id: string): Promise<ExecutablePlanV1 | undefined>;
  getEvidence(runId: string): Promise<EvidenceManifestV1 | undefined>;
}

export interface EnvironmentProbe {
  probe(environment: EnvironmentDefinitionV1): Promise<ProbeResultV1>;
}

export interface CompileOnlyRunInput {
  runId: string;
  environmentId: string;
  scenarioId: string;
  variationValues?: Record<string, string>;
  now: string;
  target?: { version?: string; commit?: string };
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

export class NvsCore {
  constructor(
    private readonly environments: EnvironmentRepository,
    private readonly scenarios: ScenarioRepository,
    private readonly bundles: RunBundleRepository,
    private readonly probeAdapter: EnvironmentProbe,
    private readonly actorReadiness?: ActorReadinessDependencies,
  ) {}

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

  async createCompileOnlyRun(input: CompileOnlyRunInput): Promise<RunRecordV1> {
    const environment = await this.getEnvironment(input.environmentId);
    enforceEnvironmentOperationPolicy(environment, 'COMPILE_ONLY');
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

    return this.bundles.saveBundle({ run, plan, evidenceManifest: manifest });
  }

  listRuns(): Promise<RunRecordV1[]> {
    return this.bundles.list();
  }

  async getRun(id: string): Promise<RunRecordV1> {
    const run = await this.bundles.get(id);
    if (!run) {
      throw new Error(`Run "${id}" was not found.`);
    }
    return run;
  }

  async getPlan(runId: string): Promise<ExecutablePlanV1> {
    const plan = await this.bundles.getPlan(runId);
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
