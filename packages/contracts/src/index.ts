import { z } from 'zod';

export const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$/;
export const safeIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(SAFE_ID_PATTERN, 'must be a lowercase safe identifier');

const symbolicRefSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]+$/, 'must be a symbolic, non-secret reference');

const relativeEndpointSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\/(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^?#]*$/, 'must be a safe relative endpoint path');

export const artifactRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split('/').includes('..'),
    'must be an artifact-relative path',
  );

const safeBaseUrlSchema = z.url().superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    context.addIssue({ code: 'custom', message: 'baseUrl must use http or https' });
  }
  if (url.username || url.password) {
    context.addIssue({ code: 'custom', message: 'credentials are forbidden in baseUrl' });
  }
  if (url.search || url.hash) {
    context.addIssue({ code: 'custom', message: 'baseUrl cannot contain query or fragment data' });
  }
});

export const environmentDefinitionV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.environment/v1'),
    id: safeIdSchema,
    displayName: z.string().min(1).max(120),
    baseUrl: safeBaseUrlSchema,
    kind: z.enum(['local', 'test', 'staging', 'production']),
    healthPath: relativeEndpointSchema,
    readinessPath: relativeEndpointSchema.optional(),
    openApiPath: relativeEndpointSchema.optional(),
    versionPath: relativeEndpointSchema.optional(),
    capabilities: z
      .object({
        health: z.literal(true),
        readiness: z.boolean(),
        openApi: z.boolean(),
        version: z.boolean(),
      })
      .strict(),
    authProfileRef: symbolicRefSchema.optional(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.capabilities.openApi !== Boolean(environment.openApiPath)) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities', 'openApi'],
        message: 'openApi capability and openApiPath must agree',
      });
    }
    if (environment.capabilities.readiness !== Boolean(environment.readinessPath)) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities', 'readiness'],
        message: 'readiness capability and readinessPath must agree',
      });
    }
    if (environment.capabilities.version !== Boolean(environment.versionPath)) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities', 'version'],
        message: 'version capability and versionPath must agree',
      });
    }
  });

export type EnvironmentDefinitionV1 = z.infer<typeof environmentDefinitionV1Schema>;

export const semanticActionSchema = z.enum([
  'incident.report',
  'incident.triage',
  'incident.assign',
  'incident.take_ownership',
  'incident.link_service_context',
  'incident.hold',
  'incident.resume',
  'incident.resolve',
  'incident.close',
  'incident.read',
  'sla.read_summary',
  'evidence.read_audit',
]);

const actorSchema = z
  .object({
    id: safeIdSchema,
    name: z.string().min(1).max(120),
    persona: z.string().min(1).max(300),
    authProfileRef: symbolicRefSchema.optional(),
  })
  .strict();

const expectationKindSchema = z.enum([
  'STATE',
  'SLA',
  'AUTHORIZATION',
  'RELATIONSHIP',
  'AUDIT',
  'EVENT',
  'NOTIFICATION',
  'EVIDENCE',
  'SIDE_EFFECT',
]);

const expectationSchema = z
  .object({
    kind: expectationKindSchema,
    statement: z.string().min(1).max(500),
  })
  .strict();

const inputValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
export type InputValue = z.infer<typeof inputValueSchema>;

const businessStepSchema = z
  .object({
    id: safeIdSchema,
    title: z.string().min(1).max(160),
    narrative: z.string().min(1).max(800),
    actor: safeIdSchema,
    action: semanticActionSchema,
    inputs: z.record(z.string().min(1).max(80), inputValueSchema),
    expectations: z.array(expectationSchema).min(1),
    evidence: z.array(z.string().min(1).max(200)).min(1),
  })
  .strict();

const variationOverridesSchema = z
  .object({
    stepOrder: z.array(safeIdSchema).optional(),
    skipStepIds: z.array(safeIdSchema).optional(),
    stepActorOverrides: z.record(safeIdSchema, safeIdSchema).optional(),
    inputOverrides: z
      .record(safeIdSchema, z.record(z.string().min(1).max(80), inputValueSchema))
      .optional(),
    expectedOutcome: z
      .enum([
        'SUCCESS',
        'MISSING_EVIDENCE',
        'INVALID_TRANSITION',
        'ACCESS_DENIED',
        'SLA_VALIDATION',
      ])
      .optional(),
  })
  .strict();

const variationDimensionSchema = z
  .object({
    id: safeIdSchema,
    description: z.string().min(1).max(300),
    values: z
      .array(
        z
          .object({
            id: safeIdSchema,
            description: z.string().min(1).max(300),
            overrides: variationOverridesSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const businessBlueprintV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.blueprint/v1'),
    id: safeIdSchema,
    version: z.string().regex(/^[1-9]\d*\.\d+\.\d+$/, 'must be a semantic version'),
    title: z.string().min(1).max(200),
    narrative: z.string().min(40).max(3000),
    objective: z.string().min(20).max(1000),
    domain: safeIdSchema,
    process: safeIdSchema,
    riskTags: z.array(safeIdSchema).min(1),
    reviewState: z.enum(['generated', 'reviewed', 'approved']),
    provenance: z
      .object({
        source: z.string().min(1).max(200),
        approvedBy: z.string().min(1).max(120).optional(),
        reviewedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict(),
    actors: z.array(actorSchema).min(1),
    preconditions: z.array(z.string().min(1).max(500)).min(1),
    fixtureRequirements: z
      .array(
        z
          .object({
            id: safeIdSchema,
            ref: symbolicRefSchema,
            description: z.string().min(1).max(300),
          })
          .strict(),
      )
      .min(1),
    symbolicRefs: z
      .array(
        z
          .object({
            id: safeIdSchema,
            description: z.string().min(1).max(300),
            required: z.boolean(),
          })
          .strict(),
      )
      .min(1),
    steps: z.array(businessStepSchema).min(1),
    variationDimensions: z.array(variationDimensionSchema).min(1),
    evidenceRequirements: z.array(z.string().min(1).max(300)).min(1),
    cleanup: z
      .object({
        isolation: z.enum(['RUN_NAMESPACE', 'TENANT_NAMESPACE']),
        intent: z.string().min(1).max(500),
        retainOnFailure: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((blueprint, context) => {
    const actorIds = new Set(blueprint.actors.map((actor) => actor.id));
    const stepIds = new Set(blueprint.steps.map((step) => step.id));
    const refIds = new Set(blueprint.symbolicRefs.map((ref) => ref.id));
    const duplicate = <T>(values: T[]) =>
      values.some((value, index) => values.indexOf(value) !== index);

    if (duplicate(blueprint.actors.map((actor) => actor.id))) {
      context.addIssue({ code: 'custom', path: ['actors'], message: 'actor IDs must be unique' });
    }
    if (duplicate(blueprint.steps.map((step) => step.id))) {
      context.addIssue({ code: 'custom', path: ['steps'], message: 'step IDs must be unique' });
    }
    if (duplicate(blueprint.variationDimensions.map((dimension) => dimension.id))) {
      context.addIssue({
        code: 'custom',
        path: ['variationDimensions'],
        message: 'variation dimension IDs must be unique',
      });
    }

    blueprint.steps.forEach((step, index) => {
      if (!actorIds.has(step.actor)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'actor'],
          message: 'step actor must reference a declared actor',
        });
      }
      Object.values(step.inputs).forEach((input) => {
        if (typeof input === 'string') {
          const match = /^\$\{([a-z0-9._-]+)\}$/.exec(input);
          if (match?.[1] && !refIds.has(match[1])) {
            context.addIssue({
              code: 'custom',
              path: ['steps', index, 'inputs'],
              message: `unknown symbolic reference: ${match[1]}`,
            });
          }
        }
      });
    });

    blueprint.variationDimensions.forEach((dimension, dimensionIndex) => {
      if (duplicate(dimension.values.map((value) => value.id))) {
        context.addIssue({
          code: 'custom',
          path: ['variationDimensions', dimensionIndex, 'values'],
          message: 'variation value IDs must be unique',
        });
      }
      dimension.values.forEach((value, valueIndex) => {
        const override = value.overrides;
        const referencedSteps = [
          ...(override.stepOrder ?? []),
          ...(override.skipStepIds ?? []),
          ...Object.keys(override.stepActorOverrides ?? {}),
          ...Object.keys(override.inputOverrides ?? {}),
        ];
        if (referencedSteps.some((stepId) => !stepIds.has(stepId))) {
          context.addIssue({
            code: 'custom',
            path: ['variationDimensions', dimensionIndex, 'values', valueIndex, 'overrides'],
            message: 'variation override references an unknown step',
          });
        }
        if (
          override.stepActorOverrides &&
          Object.values(override.stepActorOverrides).some((actorId) => !actorIds.has(actorId))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['variationDimensions', dimensionIndex, 'values', valueIndex, 'overrides'],
            message: 'variation override references an unknown actor',
          });
        }
        if (
          override.stepOrder &&
          (override.stepOrder.length !== stepIds.size ||
            new Set(override.stepOrder).size !== stepIds.size)
        ) {
          context.addIssue({
            code: 'custom',
            path: [
              'variationDimensions',
              dimensionIndex,
              'values',
              valueIndex,
              'overrides',
              'stepOrder',
            ],
            message: 'stepOrder must contain every step exactly once',
          });
        }
      });
    });
  });

export type BusinessBlueprintV1 = z.infer<typeof businessBlueprintV1Schema>;
export type VariationOverrides = z.infer<typeof variationOverridesSchema>;

const resolvedInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('RESOLVED'), value: inputValueSchema }).strict(),
  z.object({ kind: z.literal('SYMBOLIC'), ref: safeIdSchema }).strict(),
]);

const executableAssertionSchema = z
  .object({
    id: safeIdSchema,
    kind: expectationKindSchema,
    statement: z.string().min(1).max(500),
  })
  .strict();

export const executablePlanV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.plan/v1'),
    id: safeIdSchema,
    scenario: z.object({ id: safeIdSchema, version: z.string() }).strict(),
    variationValues: z.record(safeIdSchema, safeIdSchema),
    expectedOutcome: z.enum([
      'SUCCESS',
      'MISSING_EVIDENCE',
      'INVALID_TRANSITION',
      'ACCESS_DENIED',
      'SLA_VALIDATION',
    ]),
    actors: z.array(actorSchema),
    steps: z.array(
      z
        .object({
          id: safeIdSchema,
          sequence: z.number().int().positive(),
          actorId: safeIdSchema,
          action: semanticActionSchema,
          inputs: z.record(z.string(), resolvedInputSchema),
          assertions: z.array(executableAssertionSchema),
          evidenceRequests: z.array(z.string()),
          source: z
            .object({
              blueprintStepId: safeIdSchema,
              variationValues: z.record(safeIdSchema, safeIdSchema),
            })
            .strict(),
        })
        .strict(),
    ),
    evidenceRequests: z.array(z.string()),
    cleanupIntent: z
      .object({
        isolation: z.enum(['RUN_NAMESPACE', 'TENANT_NAMESPACE']),
        intent: z.string(),
        retainOnFailure: z.boolean(),
      })
      .strict(),
    source: z
      .object({
        blueprintSchemaVersion: z.literal('nvs.blueprint/v1'),
        blueprintId: safeIdSchema,
        blueprintVersion: z.string(),
      })
      .strict(),
  })
  .strict();

export type ExecutablePlanV1 = z.infer<typeof executablePlanV1Schema>;

export const verdictSchema = z.enum(['PASS', 'FAIL', 'BLOCKED']);
export const errorCategorySchema = z.enum([
  'PRODUCT',
  'ASSERTION',
  'ADAPTER',
  'ENVIRONMENT',
  'SCENARIO_CONTRACT',
  'PERSISTENCE',
  'CLEANUP',
  'CANCELLATION',
]);
export type ErrorCategory = z.infer<typeof errorCategorySchema>;

export const typedErrorSchema = z
  .object({
    category: errorCategorySchema,
    code: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Z0-9_]+$/),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();
export type TypedError = z.infer<typeof typedErrorSchema>;

const sanitizationSchema = z
  .object({
    applied: z.boolean(),
    redactedFields: z.array(z.string().max(100)),
    patterns: z.array(z.string().max(100)),
  })
  .strict();

export const evidenceEntryV1Schema = z
  .object({
    id: safeIdSchema,
    kind: z.enum(['PLAN', 'MANIFEST', 'LOG', 'REQUEST', 'RESPONSE', 'OBSERVATION']),
    path: artifactRelativePathSchema,
    mediaType: z.string().min(1).max(100),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type EvidenceEntryV1 = z.infer<typeof evidenceEntryV1Schema>;

export const evidenceManifestV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.evidence/v1'),
    runId: safeIdSchema,
    entries: z.array(evidenceEntryV1Schema),
    sanitization: sanitizationSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type EvidenceManifestV1 = z.infer<typeof evidenceManifestV1Schema>;

export const runRecordV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.run/v1'),
    runId: safeIdSchema,
    runType: z.literal('COMPILE_ONLY'),
    status: z.enum(['CREATED', 'RUNNING', 'COMPLETED']),
    verdict: verdictSchema,
    gateEligible: z.literal(false),
    assuranceScope: z.literal('COMPILATION_ONLY'),
    environmentId: safeIdSchema,
    scenario: z.object({ id: safeIdSchema, version: z.string() }).strict(),
    variationValues: z.record(safeIdSchema, safeIdSchema),
    planId: safeIdSchema,
    target: z
      .object({
        version: z.string().max(120).optional(),
        commit: z.string().max(120).optional(),
      })
      .strict()
      .optional(),
    toolVersions: z
      .object({
        nvs: z.string().min(1),
        node: z.string().min(1),
        contracts: z.literal('v1'),
      })
      .strict(),
    timestamps: z
      .object({
        createdAt: z.iso.datetime({ offset: true }),
        completedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
    stepResults: z.array(
      z
        .object({
          stepId: safeIdSchema,
          status: z.enum(['PASS', 'FAIL', 'BLOCKED']),
          error: typedErrorSchema.optional(),
        })
        .strict(),
    ),
    error: typedErrorSchema.optional(),
    evidence: z.array(evidenceEntryV1Schema),
    sanitization: sanitizationSchema,
    cleanup: z
      .object({
        status: z.enum(['CLEAN', 'RETAINED_BY_POLICY', 'PARTIAL', 'UNKNOWN', 'NOT_REQUIRED']),
        details: z.string().max(300).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.runType === 'COMPILE_ONLY' && run.gateEligible !== false) {
      context.addIssue({
        code: 'custom',
        path: ['gateEligible'],
        message: 'compile-only is never gate eligible',
      });
    }
    if (run.verdict === 'PASS' && run.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'PASS cannot include an error',
      });
    }
  });

export type RunRecordV1 = z.infer<typeof runRecordV1Schema>;

export const probeResultV1Schema = z
  .object({
    environmentId: safeIdSchema,
    verdict: z.enum(['PASS', 'BLOCKED']),
    health: z
      .object({
        available: z.boolean(),
        status: z.number().int().min(0).max(599).optional(),
      })
      .strict(),
    readiness: z
      .object({
        available: z.boolean(),
        status: z.number().int().min(0).max(599).optional(),
        state: z.string().max(80).optional(),
      })
      .strict(),
    openApi: z
      .object({
        available: z.boolean(),
        status: z.number().int().min(0).max(599).optional(),
      })
      .strict(),
    version: z
      .object({
        available: z.boolean(),
        status: z.number().int().min(0).max(599).optional(),
        commit: z.string().max(120).optional(),
        buildTimestamp: z.string().max(120).optional(),
        source: z.enum(['NONE', 'HEALTH_VERSION']),
      })
      .strict(),
    error: typedErrorSchema.optional(),
  })
  .strict();
export type ProbeResultV1 = z.infer<typeof probeResultV1Schema>;

export interface CoverageCell {
  scenarioId: string;
  variation: string;
  actors: string[];
  actions: string[];
  assertionKinds: string[];
  expectedOutcome:
    'SUCCESS' | 'MISSING_EVIDENCE' | 'INVALID_TRANSITION' | 'ACCESS_DENIED' | 'SLA_VALIDATION';
  status: 'DECLARED_COMPILED_NOT_EXECUTED';
}

export function assertNoObviousSecretFields(value: unknown): void {
  const secretKey = /^(?:password|secret|token|api[-_]?key|authorization|cookie)$/i;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (secretKey.test(key)) {
          throw new Error(`secret-bearing field "${key}" is forbidden in versioned input`);
        }
        visit(child);
      }
    }
  };
  visit(value);
}

export function parseEnvironmentDefinition(value: unknown): EnvironmentDefinitionV1 {
  assertNoObviousSecretFields(value);
  return environmentDefinitionV1Schema.parse(value);
}

export function parseBusinessBlueprint(value: unknown): BusinessBlueprintV1 {
  assertNoObviousSecretFields(value);
  return businessBlueprintV1Schema.parse(value);
}
