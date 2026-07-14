export interface TypedError {
  category: string;
  code: string;
  message: string;
  retryable: boolean;
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
  enabled: boolean;
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
  kind: string;
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

export interface RunRecord {
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
    status: 'PASS' | 'FAIL' | 'BLOCKED';
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
