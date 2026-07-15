import { z } from 'zod';

export const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$/;
export const safeIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(SAFE_ID_PATTERN, 'must be a lowercase safe identifier');

export const symbolicRefSchema = z
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

export const runTypeSchema = z.enum(['COMPILE_ONLY', 'LIVE_API']);
export type RunType = z.infer<typeof runTypeSchema>;

const liveRunAllowlistEntrySchema = z
  .object({
    scenarioId: safeIdSchema,
    variationValues: z.record(safeIdSchema, safeIdSchema),
  })
  .strict();

const environmentExecutionPolicyV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.environment-execution-policy/v1'),
    liveApiEnabled: z.boolean(),
    allowedRunTypes: z.array(runTypeSchema).min(1),
    fixtureProfileRef: symbolicRefSchema.optional(),
    liveRunAllowlist: z.array(liveRunAllowlistEntrySchema),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.liveApiEnabled && !policy.allowedRunTypes.includes('LIVE_API')) {
      context.addIssue({
        code: 'custom',
        path: ['allowedRunTypes'],
        message: 'live API policy must allow LIVE_API when liveApiEnabled is true',
      });
    }
  });
export type EnvironmentExecutionPolicyV1 = z.infer<typeof environmentExecutionPolicyV1Schema>;

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
    execution: environmentExecutionPolicyV1Schema.optional(),
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

export const actorPersonaSchema = z.enum([
  'requester',
  'service-desk-agent',
  'incident-manager',
  'tenant-admin',
  'cross-tenant-agent',
]);
export type ActorPersona = z.infer<typeof actorPersonaSchema>;

export const actorProfileV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.actor-profile/v1'),
    id: safeIdSchema,
    displayName: z.string().min(1).max(120),
    persona: actorPersonaSchema,
    environmentId: safeIdSchema,
    tenantId: z.uuid().optional(),
    credentialRef: symbolicRefSchema,
    expectedDomains: z.array(safeIdSchema).max(20),
    expectedRoles: z.array(safeIdSchema).max(20),
    capabilityNotes: z.array(z.string().min(1).max(240)).max(30),
    enabled: z.boolean(),
    mfa: z.enum(['NOT_EXPECTED', 'EXPECTED', 'UNSUPPORTED']),
    provenance: z
      .object({
        source: z.string().min(1).max(200),
        reviewedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict(),
  })
  .strict();
export type ActorProfileV1 = z.infer<typeof actorProfileV1Schema>;

export const environmentActorMapV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.environment-actor-map/v1'),
    environmentId: safeIdSchema,
    actors: z
      .object({
        requester: safeIdSchema,
        'service-desk-agent': safeIdSchema,
        'incident-manager': safeIdSchema,
        'tenant-admin': safeIdSchema,
        'cross-tenant-agent': safeIdSchema,
      })
      .strict(),
    provenance: z
      .object({
        source: z.string().min(1).max(200),
        reviewedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict(),
  })
  .strict();
export type EnvironmentActorMapV1 = z.infer<typeof environmentActorMapV1Schema>;

export const semanticActionSchema = z.enum([
  'incident.report',
  'incident.triage',
  'incident.assign',
  'incident.take_ownership',
  'incident.start_work',
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
const SYMBOLIC_INPUT_PATTERN = /^\$\{([a-z0-9._-]+)\}$/;

function validateSymbolicInputs(
  inputs: Record<string, InputValue>,
  refIds: ReadonlySet<string>,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  Object.entries(inputs).forEach(([key, input]) => {
    if (typeof input !== 'string') {
      return;
    }
    const match = SYMBOLIC_INPUT_PATTERN.exec(input);
    if (match?.[1] && !refIds.has(match[1])) {
      context.addIssue({
        code: 'custom',
        path: [...path, key],
        message: `unknown symbolic reference: ${match[1]}`,
      });
    }
  });
}

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
      validateSymbolicInputs(step.inputs, refIds, context, ['steps', index, 'inputs']);
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
        Object.entries(override.inputOverrides ?? {}).forEach(([stepId, inputs]) => {
          validateSymbolicInputs(inputs, refIds, context, [
            'variationDimensions',
            dimensionIndex,
            'values',
            valueIndex,
            'overrides',
            'inputOverrides',
            stepId,
          ]);
        });
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

const incidentImpactSchema = z.enum(['low', 'medium', 'high']);
const incidentUrgencySchema = z.enum(['low', 'medium', 'high']);
const incidentStatusSchema = z.enum(['open', 'in_progress', 'on_hold', 'resolved', 'closed']);

const fixtureResourceRefSchema = z
  .object({
    id: z.uuid(),
    label: z.string().min(1).max(160).optional(),
  })
  .strict();

export const nilesIncidentFixtureV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.niles-incident-fixture/v1'),
    id: safeIdSchema,
    environmentId: safeIdSchema,
    enabled: z.boolean(),
    tenantId: z.uuid(),
    runNamespacePrefix: safeIdSchema,
    scenarioAllowlist: z.array(liveRunAllowlistEntrySchema).min(1),
    resources: z
      .object({
        assignmentGroup: fixtureResourceRefSchema,
        service: fixtureResourceRefSchema,
        offering: fixtureResourceRefSchema.optional(),
        configurationItem: fixtureResourceRefSchema.optional(),
        affectedCi: z
          .object({
            relationshipType: z.string().min(1).max(80).default('affected'),
            impactScope: z.string().min(1).max(120).optional(),
          })
          .strict()
          .default({ relationshipType: 'affected', impactScope: 'service-impact' }),
        impact: incidentImpactSchema,
        urgency: incidentUrgencySchema,
        expectedPriority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
        hold: z
          .object({
            pendingReason: z.string().min(1).max(100),
            pendingReasonDetail: z.string().min(12).max(500),
          })
          .strict(),
        resolutionNotes: z.string().min(20).max(1000),
        closeAuthority: z
          .object({
            strategy: z.enum(['REQUESTER_CONFIRMATION', 'BLOCK_IF_UNSATISFIABLE']),
            requesterMustHaveIncidentWrite: z.boolean(),
          })
          .strict(),
        sla: z
          .object({
            required: z.boolean(),
            policyRef: symbolicRefSchema.optional(),
            objectiveTypes: z.array(z.enum(['response', 'resolution'])).default([]),
          })
          .strict(),
      })
      .strict(),
    cleanup: z
      .object({
        onPass: z.literal('RETAIN_CLOSED'),
        onFail: z.literal('RETAIN_FOR_DIAGNOSIS'),
        onBlockedBeforeClose: z.literal('DELETE_IF_RUN_OWNED'),
      })
      .strict(),
    provenance: z
      .object({
        source: z.string().min(1).max(240),
        grcCommit: z.string().regex(/^[a-f0-9]{7,40}$/i),
        reviewedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.resources.closeAuthority.strategy === 'REQUESTER_CONFIRMATION') {
      return;
    }
    if (fixture.resources.closeAuthority.requesterMustHaveIncidentWrite) {
      context.addIssue({
        code: 'custom',
        path: ['resources', 'closeAuthority', 'requesterMustHaveIncidentWrite'],
        message: 'BLOCK_IF_UNSATISFIABLE is only valid when requester write authority is absent',
      });
    }
  });
export type NilesIncidentFixtureV1 = z.infer<typeof nilesIncidentFixtureV1Schema>;

export const readinessCheckStatusSchema = z.enum(['PASS', 'BLOCKED', 'NOT_CHECKED']);
export const executionReadinessV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.execution-readiness/v1'),
    environmentId: safeIdSchema,
    runType: z.literal('LIVE_API'),
    scenarioId: safeIdSchema.optional(),
    variationValues: z.record(safeIdSchema, safeIdSchema).optional(),
    confirmed: z.boolean().default(false),
    staticEligible: z.boolean().default(false),
    verdict: z.enum(['PASS', 'BLOCKED']),
    mutationEligible: z.boolean(),
    gateEligible: z.literal(false),
    checks: z.array(
      z
        .object({
          id: safeIdSchema,
          status: readinessCheckStatusSchema,
          message: z.string().min(1).max(300),
          code: z
            .string()
            .min(1)
            .max(100)
            .regex(/^[A-Z0-9_]+$/)
            .optional(),
        })
        .strict(),
    ),
    error: typedErrorSchema.optional(),
  })
  .strict()
  .superRefine((readiness, context) => {
    if (readiness.verdict === 'PASS' && readiness.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'PASS readiness cannot include an error',
      });
    }
  });
export type ExecutionReadinessV1 = z.infer<typeof executionReadinessV1Schema>;

export const actorCredentialConfigurationSchema = z.enum([
  'NOT_CONFIGURED',
  'CONFIGURED',
  'INVALID',
  'DISABLED',
]);
export type ActorCredentialConfiguration = z.infer<typeof actorCredentialConfigurationSchema>;

export const actorAuthenticationStateSchema = z.enum([
  'NOT_ATTEMPTED',
  'AUTHENTICATED',
  'BLOCKED',
  'DISABLED',
]);
export type ActorAuthenticationState = z.infer<typeof actorAuthenticationStateSchema>;

export const actorReadinessV1Schema = z
  .object({
    actorProfileId: safeIdSchema,
    displayName: z.string().min(1).max(120),
    persona: actorPersonaSchema,
    credentialConfiguration: actorCredentialConfigurationSchema,
    authenticationState: actorAuthenticationStateSchema,
    expectedTenantId: z.uuid().optional(),
    observedTenantId: z.uuid().optional(),
    userId: z.uuid().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    correlationId: safeIdSchema.optional(),
    timestamp: z.iso.datetime({ offset: true }).optional(),
    error: typedErrorSchema.optional(),
  })
  .strict()
  .superRefine((actor, context) => {
    if (actor.authenticationState === 'AUTHENTICATED' && actor.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'an authenticated actor cannot include an error',
      });
    }
    if (actor.authenticationState === 'BLOCKED' && !actor.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a blocked actor requires a typed error',
      });
    }
  });
export type ActorReadinessV1 = z.infer<typeof actorReadinessV1Schema>;

export const actorListV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.actor-list/v1'),
    environmentId: safeIdSchema,
    gateEligible: z.literal(false),
    actors: z.array(actorReadinessV1Schema).min(1),
  })
  .strict();
export type ActorListV1 = z.infer<typeof actorListV1Schema>;

export const authPreflightV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.auth-preflight/v1'),
    environmentId: safeIdSchema,
    verdict: z.enum(['PASS', 'BLOCKED']),
    gateEligible: z.literal(false),
    assuranceScope: z.literal('AUTHENTICATION_READINESS_ONLY'),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    actors: z.array(actorReadinessV1Schema).min(1),
  })
  .strict()
  .superRefine((preflight, context) => {
    if (
      preflight.verdict === 'PASS' &&
      preflight.actors.some((actor) => actor.authenticationState !== 'AUTHENTICATED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actors'],
        message: 'a PASS preflight requires every mapped actor to authenticate',
      });
    }
  });
export type AuthPreflightV1 = z.infer<typeof authPreflightV1Schema>;

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
    kind: z.enum(['RUN', 'PLAN', 'MANIFEST', 'LOG', 'REQUEST', 'RESPONSE', 'OBSERVATION']),
    path: artifactRelativePathSchema,
    mediaType: z.string().min(1).max(100),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type EvidenceEntryV1 = z.infer<typeof evidenceEntryV1Schema>;

function validateBundleIndex(
  runId: string,
  entries: EvidenceEntryV1[],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const required = [
    { id: 'run-record', kind: 'RUN', path: `runs/${runId}/run.json` },
    { id: 'compiled-plan', kind: 'PLAN', path: `runs/${runId}/plan.json` },
    { id: 'evidence-manifest', kind: 'MANIFEST', path: `runs/${runId}/evidence.json` },
  ] as const;
  required.forEach((expected) => {
    const entry = entries.find((candidate) => candidate.id === expected.id);
    if (!entry || entry.kind !== expected.kind || entry.path !== expected.path) {
      context.addIssue({
        code: 'custom',
        path,
        message: `bundle index must include ${expected.path}`,
      });
    }
  });
}

export const evidenceManifestV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.evidence/v1'),
    runId: safeIdSchema,
    entries: z.array(evidenceEntryV1Schema),
    sanitization: sanitizationSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateBundleIndex(manifest.runId, manifest.entries, context, ['entries']);
  });
export type EvidenceManifestV1 = z.infer<typeof evidenceManifestV1Schema>;

export const compileOnlyStepResultV1Schema = z
  .object({
    stepId: safeIdSchema,
    compilationStatus: verdictSchema,
    executionStatus: z.literal('NOT_EXECUTED'),
    error: typedErrorSchema.optional(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.compilationStatus === 'PASS' && step.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a passed compilation step cannot include an error',
      });
    }
    if (step.compilationStatus !== 'PASS' && !step.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a failed or blocked compilation step requires an error',
      });
    }
  });

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
    stepResults: z.array(compileOnlyStepResultV1Schema),
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
    if (
      run.verdict === 'PASS' &&
      run.stepResults.some((step) => step.compilationStatus !== 'PASS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stepResults'],
        message: 'a PASS run requires every compilation step to pass',
      });
    }
    validateBundleIndex(run.runId, run.evidence, context, ['evidence']);
  });

export type RunRecordV1 = z.infer<typeof runRecordV1Schema>;

export const resourceDispositionSchema = z.enum([
  'NONE',
  'VERIFIED_EXISTING',
  'CREATED',
  'UPDATED',
  'RESOLVED',
  'DELETED',
  'RETAINED_CLOSED',
  'RETAINED_FOR_DIAGNOSIS',
  'UNKNOWN',
]);
export type ResourceDisposition = z.infer<typeof resourceDispositionSchema>;

const inventoryResourceSchema = z
  .object({
    kind: z.enum(['TENANT', 'ASSIGNMENT_GROUP', 'SERVICE', 'OFFERING', 'CI', 'INCIDENT', 'SLA']),
    id: z.string().min(1).max(160),
    label: z.string().min(1).max(160).optional(),
    disposition: resourceDispositionSchema,
  })
  .strict();

export const resourceInventoryV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.resource-inventory/v1'),
    runId: safeIdSchema,
    environmentId: safeIdSchema,
    tenantId: z.uuid(),
    scenario: z
      .object({
        id: safeIdSchema,
        version: z.string().min(1).max(80),
      })
      .strict()
      .optional(),
    createdAt: z.iso.datetime({ offset: true }).optional(),
    createdBy: z
      .object({
        semanticActorId: safeIdSchema,
        operationalActorId: safeIdSchema,
      })
      .strict()
      .optional(),
    incident: z
      .object({
        id: z.uuid(),
        number: z.string().min(1).max(80).optional(),
        status: incidentStatusSchema.optional(),
        disposition: resourceDispositionSchema,
      })
      .strict()
      .optional(),
    resources: z.array(inventoryResourceSchema),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ResourceInventoryV1 = z.infer<typeof resourceInventoryV1Schema>;

const observationValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(
    z
      .object({
        method: z.enum(['GET', 'POST', 'DELETE']),
        pathTemplate: z.string().min(1).max(200),
        httpStatus: z.number().int().min(0).max(599).optional(),
        durationMs: z.number().finite().nonnegative(),
        correlationId: safeIdSchema,
      })
      .strict(),
  ),
]);

export const stepObservationV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.step-observation/v1'),
    id: safeIdSchema,
    runId: safeIdSchema,
    stepId: safeIdSchema,
    sourceStepId: safeIdSchema,
    sequence: z.number().int().positive(),
    actorId: safeIdSchema,
    semanticActorId: safeIdSchema.optional(),
    actorProfileId: safeIdSchema.optional(),
    action: semanticActionSchema,
    status: z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT_OBSERVED']),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    correlationId: safeIdSchema,
    evidence: z.record(z.string().min(1).max(80), observationValueSchema),
    error: typedErrorSchema.optional(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.status === 'PASS' && observation.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a PASS observation cannot include an error',
      });
    }
    if (
      observation.status !== 'PASS' &&
      observation.status !== 'NOT_OBSERVED' &&
      !observation.error
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a failed or blocked observation requires a typed error',
      });
    }
  });
export type StepObservationV1 = z.infer<typeof stepObservationV1Schema>;

const liveStepResultV2Schema = z
  .object({
    stepId: safeIdSchema,
    executionStatus: z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT_OBSERVED']),
    required: z.boolean().default(true),
    observationId: safeIdSchema.optional(),
    error: typedErrorSchema.optional(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.executionStatus === 'PASS' && step.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a passed live step cannot include an error',
      });
    }
    if (step.executionStatus !== 'PASS' && step.executionStatus !== 'NOT_OBSERVED' && !step.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a failed or blocked live step requires an error',
      });
    }
  });

export const runRecordV2Schema = z
  .object({
    schemaVersion: z.literal('nvs.run/v2'),
    runId: safeIdSchema,
    runType: z.literal('LIVE_API'),
    status: z.enum(['CREATED', 'RUNNING', 'COMPLETED']),
    verdict: verdictSchema,
    gateEligible: z.boolean(),
    assuranceScope: z.literal('LIVE_NILES_INCIDENT_API'),
    environmentId: safeIdSchema,
    scenario: z.object({ id: safeIdSchema, version: z.string() }).strict(),
    variationValues: z.record(safeIdSchema, safeIdSchema),
    planId: safeIdSchema,
    fixtureId: safeIdSchema,
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
        contracts: z.literal('v2'),
      })
      .strict(),
    timestamps: z
      .object({
        createdAt: z.iso.datetime({ offset: true }),
        completedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
    stepResults: z.array(liveStepResultV2Schema).min(1),
    error: typedErrorSchema.optional(),
    evidence: z.array(evidenceEntryV1Schema),
    sanitization: sanitizationSchema,
    cleanup: z
      .object({
        status: z.enum(['CLEAN', 'RETAINED_BY_POLICY', 'PARTIAL', 'UNKNOWN', 'NOT_REQUIRED']),
        policy: z.enum(['RETAIN_CLOSED', 'RETAIN_FOR_DIAGNOSIS', 'DELETE_IF_RUN_OWNED']),
        details: z.string().max(400).optional(),
        error: typedErrorSchema.optional(),
      })
      .strict(),
    resourceInventory: resourceInventoryV1Schema,
  })
  .strict()
  .superRefine((run, context) => {
    validateBundleIndex(run.runId, run.evidence, context, ['evidence']);
    if (run.verdict === 'PASS' && run.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'PASS cannot include an error',
      });
    }
    if (run.verdict === 'PASS') {
      if (
        run.stepResults.some(
          (step) =>
            step.executionStatus !== 'PASS' &&
            !(step.executionStatus === 'NOT_OBSERVED' && !step.required),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['stepResults'],
          message: 'a PASS live run requires every runtime step to pass',
        });
      }
      if (
        run.cleanup.status !== 'RETAINED_BY_POLICY' ||
        run.cleanup.policy !== 'RETAIN_CLOSED' ||
        run.resourceInventory.incident?.disposition !== 'RETAINED_CLOSED'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cleanup'],
          message: 'a PASS live run requires known retained-closed incident disposition',
        });
      }
    }
    if (run.verdict !== 'PASS' && !run.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a non-PASS live run requires a typed error',
      });
    }
    if (
      run.resourceInventory.runId !== run.runId ||
      run.resourceInventory.environmentId !== run.environmentId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resourceInventory'],
        message: 'run and resource inventory identifiers must match',
      });
    }
  });
export type RunRecordV2 = z.infer<typeof runRecordV2Schema>;

export const runRecordSchema = z.union([runRecordV1Schema, runRecordV2Schema]);
export type RunRecord = z.infer<typeof runRecordSchema>;

export const liveRunCheckpointV1Schema = z
  .object({
    schemaVersion: z.literal('nvs.live-run-checkpoint/v1'),
    runId: safeIdSchema,
    environmentId: safeIdSchema,
    fixtureId: safeIdSchema,
    status: z.enum([
      'PREPARED',
      'CREATED',
      'RUNNING',
      'FINALIZING',
      'COMPLETED',
      'RECOVERY_REQUIRED',
    ]),
    incidentId: z.uuid().optional(),
    completedStepIds: z.array(safeIdSchema),
    cleanup: z
      .object({
        attempted: z.boolean(),
        status: z.enum(['NOT_REQUIRED', 'CLEAN', 'RETAINED_BY_POLICY', 'PARTIAL', 'UNKNOWN']),
      })
      .strict(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type LiveRunCheckpointV1 = z.infer<typeof liveRunCheckpointV1Schema>;

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

export function isSecretBearingFieldName(key: string): boolean {
  if (key === 'credentialRef' || key === 'authProfileRef') {
    return false;
  }
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const sensitiveTokens = new Set([
    'authorization',
    'cookie',
    'credential',
    'credentials',
    'password',
    'secret',
    'token',
  ]);
  if (tokens.some((token) => sensitiveTokens.has(token))) {
    return true;
  }
  const compact = tokens.join('');
  return compact === 'apikey' || compact === 'privatekey';
}

export function assertNoObviousSecretFields(value: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (isSecretBearingFieldName(key)) {
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

export function parseActorProfile(value: unknown): ActorProfileV1 {
  assertNoObviousSecretFields(value);
  return actorProfileV1Schema.parse(value);
}

export function parseEnvironmentActorMap(value: unknown): EnvironmentActorMapV1 {
  assertNoObviousSecretFields(value);
  return environmentActorMapV1Schema.parse(value);
}

export function parseNilesIncidentFixture(value: unknown): NilesIncidentFixtureV1 {
  assertNoObviousSecretFields(value);
  return nilesIncidentFixtureV1Schema.parse(value);
}

export function parseRunRecord(value: unknown): RunRecord {
  return runRecordSchema.parse(value);
}
