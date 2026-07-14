import { createHash } from 'node:crypto';
import {
  businessBlueprintV1Schema,
  executablePlanV1Schema,
  type BusinessBlueprintV1,
  type EnvironmentDefinitionV1,
  type ErrorCategory,
  type ExecutablePlanV1,
  type InputValue,
  type TypedError,
  type VariationOverrides,
} from '@nvs/contracts';

export class DomainPolicyError extends Error {
  readonly code = 'PRODUCTION_MUTATION_FORBIDDEN';

  constructor(environmentId: string) {
    super(`Mutating runs are forbidden for production environment "${environmentId}".`);
    this.name = 'DomainPolicyError';
  }
}

export function enforceEnvironmentOperationPolicy(
  environment: EnvironmentDefinitionV1,
  operation: 'READ_ONLY' | 'COMPILE_ONLY' | 'MUTATING',
): void {
  if (operation === 'MUTATING' && environment.kind === 'production') {
    throw new DomainPolicyError(environment.id);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sanitizeForPersistence(value: unknown): unknown {
  const sensitiveKey = /(?:authorization|cookie|password|secret|token|api[-_]?key)/i;
  const sanitizeString = (input: string): string =>
    input
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1[REDACTED]@');

  if (Array.isArray(value)) {
    return value.map(sanitizeForPersistence);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : sanitizeForPersistence(child),
      ]),
    );
  }
  return typeof value === 'string' ? sanitizeString(value) : value;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256(stableJson(value))}`;
}

function mergeOverrides(overrides: VariationOverrides[]): VariationOverrides {
  const stepOrders = overrides.flatMap((override) =>
    override.stepOrder ? [override.stepOrder] : [],
  );
  if (stepOrders.length > 1) {
    const serialized = new Set(stepOrders.map((order) => JSON.stringify(order)));
    if (serialized.size > 1) {
      throw new Error('Selected variations define conflicting step orders.');
    }
  }

  const outcomes = overrides
    .map((override) => override.expectedOutcome)
    .filter((outcome) => outcome !== undefined);
  if (new Set(outcomes).size > 1) {
    throw new Error('Selected variations define conflicting expected outcomes.');
  }

  return {
    ...(stepOrders[0] ? { stepOrder: stepOrders[0] } : {}),
    skipStepIds: [...new Set(overrides.flatMap((override) => override.skipStepIds ?? []))],
    stepActorOverrides: Object.assign(
      {},
      ...overrides.map((override) => override.stepActorOverrides ?? {}),
    ),
    inputOverrides: Object.assign(
      {},
      ...overrides.map((override) => override.inputOverrides ?? {}),
    ),
    ...(outcomes[0] ? { expectedOutcome: outcomes[0] } : {}),
  };
}

function resolveInput(
  value: InputValue,
): { kind: 'SYMBOLIC'; ref: string } | { kind: 'RESOLVED'; value: InputValue } {
  if (typeof value === 'string') {
    const symbolic = /^\$\{([a-z0-9._-]+)\}$/.exec(value);
    if (symbolic?.[1]) {
      return { kind: 'SYMBOLIC', ref: symbolic[1] };
    }
  }
  return { kind: 'RESOLVED', value };
}

export function compileBlueprint(
  blueprintInput: BusinessBlueprintV1,
  selectedVariationValues: Readonly<Record<string, string>> = {},
): ExecutablePlanV1 {
  const blueprint = businessBlueprintV1Schema.parse(blueprintInput);
  const dimensions = new Map(
    blueprint.variationDimensions.map((dimension) => [dimension.id, dimension]),
  );
  const unknownDimensions = Object.keys(selectedVariationValues).filter(
    (id) => !dimensions.has(id),
  );
  if (unknownDimensions.length > 0) {
    throw new Error(`Unknown variation dimensions: ${unknownDimensions.join(', ')}`);
  }

  const selections: Record<string, string> = {};
  const selectedOverrides: VariationOverrides[] = [];
  for (const dimension of blueprint.variationDimensions) {
    const selectedId = selectedVariationValues[dimension.id] ?? dimension.values[0]?.id;
    const selectedValue = dimension.values.find((value) => value.id === selectedId);
    if (!selectedId || !selectedValue) {
      throw new Error(`Unknown value "${selectedId ?? ''}" for variation "${dimension.id}".`);
    }
    selections[dimension.id] = selectedValue.id;
    selectedOverrides.push(selectedValue.overrides);
  }

  const overrides = mergeOverrides(selectedOverrides);
  const planId = stableId('plan', {
    blueprint: blueprint.id,
    version: blueprint.version,
    selections,
  });
  const orderedIds = overrides.stepOrder ?? blueprint.steps.map((step) => step.id);
  const stepsById = new Map(blueprint.steps.map((step) => [step.id, step]));
  const skipped = new Set(overrides.skipStepIds ?? []);

  const steps = orderedIds
    .filter((stepId) => !skipped.has(stepId))
    .map((stepId, index) => {
      const step = stepsById.get(stepId);
      if (!step) {
        throw new Error(`Compiled step "${stepId}" does not exist.`);
      }
      const actorId = overrides.stepActorOverrides?.[step.id] ?? step.actor;
      const inputValues = { ...step.inputs, ...overrides.inputOverrides?.[step.id] };
      return {
        id: stableId('step', { planId, sourceStepId: step.id, sequence: index + 1 }),
        sequence: index + 1,
        actorId,
        action: step.action,
        inputs: Object.fromEntries(
          Object.entries(inputValues)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, resolveInput(value)]),
        ),
        assertions: step.expectations.map((expectation, expectationIndex) => ({
          id: stableId('assert', { planId, stepId: step.id, expectationIndex }),
          kind: expectation.kind,
          statement: expectation.statement,
        })),
        evidenceRequests: [...step.evidence],
        source: {
          blueprintStepId: step.id,
          variationValues: { ...selections },
        },
      };
    });

  return executablePlanV1Schema.parse({
    schemaVersion: 'nvs.plan/v1',
    id: planId,
    scenario: { id: blueprint.id, version: blueprint.version },
    variationValues: selections,
    expectedOutcome: overrides.expectedOutcome ?? 'SUCCESS',
    actors: blueprint.actors,
    steps,
    evidenceRequests: [...blueprint.evidenceRequirements],
    cleanupIntent: blueprint.cleanup,
    source: {
      blueprintSchemaVersion: blueprint.schemaVersion,
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.version,
    },
  });
}

export function classifyError(error: TypedError | undefined): 'PASS' | 'FAIL' | 'BLOCKED' {
  if (!error) {
    return 'PASS';
  }
  return ['PRODUCT', 'ASSERTION'].includes(error.category) ? 'FAIL' : 'BLOCKED';
}

export function typedError(
  category: ErrorCategory,
  code: string,
  message: string,
  retryable = false,
): TypedError {
  return { category, code, message, retryable };
}
