import {
  evidenceManifestV1Schema,
  runRecordV1Schema,
  type BusinessBlueprintV1,
  type CoverageCell,
  type EnvironmentDefinitionV1,
  type EvidenceManifestV1,
  type ExecutablePlanV1,
  type ProbeResultV1,
  type RunRecordV1,
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

export class NvsCore {
  constructor(
    private readonly environments: EnvironmentRepository,
    private readonly scenarios: ScenarioRepository,
    private readonly bundles: RunBundleRepository,
    private readonly probeAdapter: EnvironmentProbe,
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
