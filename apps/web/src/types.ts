export interface TypedError {
  category: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface BuildInformation {
  schemaVersion: 'nvs.version/v1';
  buildSha: string;
  buildTimestamp: string;
  releaseVersion: string;
  nodeVersion: string;
  contractVersion: string;
}

export interface ActorReadiness {
  actorProfileId: string;
  displayName: string;
  persona:
    'requester' | 'service-desk-agent' | 'incident-manager' | 'tenant-admin' | 'cross-tenant-agent';
  credentialConfiguration: 'NOT_CONFIGURED' | 'CONFIGURED' | 'INVALID' | 'DISABLED';
  authenticationState: 'NOT_ATTEMPTED' | 'AUTHENTICATED' | 'BLOCKED' | 'DISABLED';
  expectedTenantId?: string;
  observedTenantId?: string;
  userId?: string;
  durationMs?: number;
  correlationId?: string;
  timestamp?: string;
  error?: TypedError;
}

export interface ActorList {
  schemaVersion: 'nvs.actor-list/v1';
  environmentId: string;
  gateEligible: false;
  actors: ActorReadiness[];
}

export interface AuthPreflight {
  schemaVersion: 'nvs.auth-preflight/v1';
  environmentId: string;
  verdict: 'PASS' | 'BLOCKED';
  gateEligible: false;
  assuranceScope: 'AUTHENTICATION_READINESS_ONLY';
  startedAt: string;
  completedAt: string;
  actors: ActorReadiness[];
}

export interface EnvironmentDefinition {
  schemaVersion: 'nvs.environment/v1';
  id: string;
  displayName: string;
  baseUrl: string;
  kind: 'local' | 'test' | 'staging' | 'production';
  healthPath: string;
  readinessPath?: string;
  openApiPath?: string;
  versionPath?: string;
  capabilities: {
    health: true;
    readiness: boolean;
    openApi: boolean;
    version: boolean;
  };
  authProfileRef?: string;
  execution?: {
    schemaVersion: 'nvs.environment-execution-policy/v1';
    liveApiEnabled: boolean;
    allowedRunTypes: Array<'COMPILE_ONLY' | 'LIVE_API'>;
    fixtureProfileRef?: string;
    liveRunAllowlist: Array<{
      scenarioId: string;
      variationValues: Record<string, string>;
    }>;
  };
  enabled: boolean;
}

export interface ExecutionReadiness {
  schemaVersion: 'nvs.execution-readiness/v1';
  environmentId: string;
  runType: 'LIVE_API';
  scenarioId?: string;
  variationValues?: Record<string, string>;
  verdict: 'PASS' | 'BLOCKED';
  mutationEligible: boolean;
  gateEligible: false;
  checks: Array<{
    id: string;
    status: 'PASS' | 'BLOCKED' | 'NOT_CHECKED';
    message: string;
    code?: string;
  }>;
  error?: TypedError;
}

export interface ProbeResult {
  environmentId: string;
  verdict: 'PASS' | 'BLOCKED';
  health: { available: boolean; status?: number };
  readiness: { available: boolean; status?: number; state?: string };
  openApi: { available: boolean; status?: number };
  version: {
    available: boolean;
    status?: number;
    commit?: string;
    buildTimestamp?: string;
    source: 'NONE' | 'HEALTH_VERSION';
  };
  error?: TypedError;
}

export interface Actor {
  id: string;
  name: string;
  persona: string;
}

export interface Expectation {
  kind: string;
  statement: string;
}

export interface BusinessStep {
  id: string;
  title: string;
  narrative: string;
  actor: string;
  action: string;
  expectations: Expectation[];
  evidence: string[];
}

export interface VariationValue {
  id: string;
  description: string;
  overrides: {
    expectedOutcome?: string;
  };
}

export interface VariationDimension {
  id: string;
  description: string;
  values: VariationValue[];
}

export interface Scenario {
  schemaVersion: 'nvs.blueprint/v1';
  id: string;
  version: string;
  title: string;
  narrative: string;
  objective: string;
  domain: string;
  process: string;
  riskTags: string[];
  reviewState: 'generated' | 'reviewed' | 'approved';
  actors: Actor[];
  preconditions: string[];
  steps: BusinessStep[];
  variationDimensions: VariationDimension[];
  evidenceRequirements: string[];
}

export interface PlanStep {
  id: string;
  sequence: number;
  actorId: string;
  semanticActorId?: string;
  actorProfileId?: string;
  action: string;
  assertions: Array<{ id: string; kind: string; statement: string }>;
  evidenceRequests: string[];
  source: {
    blueprintStepId: string;
    variationValues: Record<string, string>;
  };
}

export interface ExecutablePlan {
  schemaVersion: 'nvs.plan/v1';
  id: string;
  scenario: { id: string; version: string };
  variationValues: Record<string, string>;
  expectedOutcome: string;
  steps: PlanStep[];
  evidenceRequests: string[];
}

export interface EvidenceEntry {
  id: string;
  kind: 'RUN' | 'PLAN' | 'MANIFEST' | 'LOG' | 'REQUEST' | 'RESPONSE' | 'OBSERVATION';
  path: string;
  mediaType: string;
  sha256?: string;
}

export interface EvidenceManifest {
  schemaVersion: 'nvs.evidence/v1';
  runId: string;
  entries: EvidenceEntry[];
  sanitization: {
    applied: boolean;
    redactedFields: string[];
    patterns: string[];
  };
  createdAt: string;
}

export interface CompileOnlyRunRecord {
  schemaVersion: 'nvs.run/v1';
  runId: string;
  runType: 'COMPILE_ONLY';
  status: 'CREATED' | 'RUNNING' | 'COMPLETED';
  verdict: 'PASS' | 'FAIL' | 'BLOCKED';
  gateEligible: false;
  assuranceScope: 'COMPILATION_ONLY';
  environmentId: string;
  scenario: { id: string; version: string };
  variationValues: Record<string, string>;
  planId: string;
  timestamps: {
    createdAt: string;
    completedAt: string;
  };
  stepResults: Array<{
    stepId: string;
    compilationStatus: 'PASS' | 'FAIL' | 'BLOCKED';
    executionStatus: 'NOT_EXECUTED';
    error?: TypedError;
  }>;
  error?: TypedError;
  evidence: EvidenceEntry[];
  sanitization: {
    applied: boolean;
    redactedFields: string[];
    patterns: string[];
  };
  cleanup: {
    status: string;
    details?: string;
  };
}

export interface ResourceInventory {
  schemaVersion: 'nvs.resource-inventory/v1';
  runId: string;
  environmentId: string;
  tenantId: string;
  incident?: {
    id: string;
    number?: string;
    status?: string;
    disposition: string;
  };
  resources: Array<{
    kind: string;
    id: string;
    label?: string;
    disposition: string;
  }>;
  updatedAt: string;
}

export interface LiveRunRecord {
  schemaVersion: 'nvs.run/v2';
  runId: string;
  runType: 'LIVE_API';
  status: 'CREATED' | 'RUNNING' | 'COMPLETED';
  verdict: 'PASS' | 'FAIL' | 'BLOCKED';
  gateEligible: boolean;
  assuranceScope: 'LIVE_NILES_INCIDENT_API';
  environmentId: string;
  scenario: { id: string; version: string };
  variationValues: Record<string, string>;
  planId: string;
  fixtureId: string;
  timestamps: {
    createdAt: string;
    completedAt: string;
  };
  stepResults: Array<{
    stepId: string;
    executionStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_OBSERVED';
    required?: boolean;
    observationId?: string;
    error?: TypedError;
  }>;
  error?: TypedError;
  evidence: EvidenceEntry[];
  sanitization: {
    applied: boolean;
    redactedFields: string[];
    patterns: string[];
  };
  cleanup: {
    status: string;
    policy: string;
    details?: string;
  };
  resourceInventory: ResourceInventory;
}

export interface StepObservation {
  schemaVersion: 'nvs.step-observation/v1';
  id: string;
  runId: string;
  stepId: string;
  sourceStepId: string;
  sequence: number;
  actorId: string;
  action: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_OBSERVED';
  startedAt: string;
  completedAt: string;
  correlationId: string;
  evidence: Record<string, string | number | boolean | null>;
  error?: TypedError;
}

export interface RunProgress {
  schemaVersion: 'nvs.run-progress/v1';
  runId: string;
  status: 'PREPARED' | 'CREATED' | 'RUNNING' | 'FINALIZING' | 'COMPLETED' | 'RECOVERY_REQUIRED';
  verdict: 'PENDING' | 'PASS' | 'FAIL' | 'BLOCKED';
  observations: StepObservation[];
  checkpoint?: {
    status: 'PREPARED' | 'CREATED' | 'RUNNING' | 'FINALIZING' | 'COMPLETED' | 'RECOVERY_REQUIRED';
    completedStepIds: string[];
    incidentId?: string;
  };
}

export type RunRecord = CompileOnlyRunRecord | LiveRunRecord;

export interface CoverageCell {
  scenarioId: string;
  variation: string;
  actors: string[];
  actions: string[];
  assertionKinds: string[];
  expectedOutcome: string;
  status: 'DECLARED_COMPILED_NOT_EXECUTED';
}

export interface CoverageResult {
  summary: { cells: number; executed: number };
  cells: CoverageCell[];
}
