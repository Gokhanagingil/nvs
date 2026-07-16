import { readFile, writeFile, rm } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after, 'utf8');
}

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`Missing replacement target: ${label}`);
  if (text.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Replacement target is not unique: ${label}`);
  }
  return text.slice(0, first) + to + text.slice(first + from.length);
}

await edit('packages/core/src/index.ts', (source) => {
  source = replaceOnce(
    source,
    "  readSlaSummary(input: {\n    environment: EnvironmentDefinitionV1;\n    session: ActorSession;\n    tenantId: string;\n    incidentId: string;\n    correlationId: string;\n  }): Promise<NilesSlaSummary>;",
    "  readSlaSummary(input: {\n    environment: EnvironmentDefinitionV1;\n    session: ActorSession;\n    tenantId: string;\n    incidentId: string;\n    correlationId: string;\n  }): Promise<NilesSlaSummary>;\n  readChoiceValues?(input: {\n    environment: EnvironmentDefinitionV1;\n    session: ActorSession;\n    tenantId: string;\n    table: 'itsm_incidents' | 'itsm_incident_ci';\n    field: 'pendingReason' | 'relationshipType' | 'impactScope';\n    correlationId: string;\n  }): Promise<{ values: string[]; transport?: NilesTransportEvidence }>;",
    'choice read port',
  );

  source = replaceOnce(
    source,
    "  backgroundCoordinator?: (operation: () => Promise<void>) => void;\n}",
    "  backgroundCoordinator?: (operation: () => Promise<void>) => void;\n  slaObservationTimeoutMs?: number;\n  slaObservationIntervalMs?: number;\n  sleep?: (milliseconds: number) => Promise<void>;\n}",
    'polling dependencies',
  );

  source = replaceOnce(
    source,
    "  'NILES_UPSTREAM_FAILURE',\n  'NILES_LIVE_ADAPTER_FAILURE',",
    "  'NILES_UPSTREAM_FAILURE',\n  'NILES_LIVE_ADAPTER_FAILURE',\n  'NILES_MALFORMED_RESPONSE',",
    'malformed create ambiguity',
  );

  source = replaceOnce(
    source,
    "  private allowlistMatches(\n",
    `  private async verifyFixtureChoiceCompatibility(\n    environment: EnvironmentDefinitionV1,\n    fixture: NilesIncidentFixtureV1,\n    session: ActorSession,\n    correlationSeed: string,\n  ): Promise<NilesTransportEvidence[]> {\n    const reader = this.liveDependencies().incidentAdapter.readChoiceValues;\n    if (!reader) {\n      return [];\n    }\n    const requirements = [\n      {\n        table: 'itsm_incidents' as const,\n        field: 'pendingReason' as const,\n        expected: fixture.resources.hold.pendingReason,\n      },\n      {\n        table: 'itsm_incident_ci' as const,\n        field: 'relationshipType' as const,\n        expected: fixture.resources.affectedCi.relationshipType,\n      },\n      ...(fixture.resources.affectedCi.impactScope\n        ? [\n            {\n              table: 'itsm_incident_ci' as const,\n              field: 'impactScope' as const,\n              expected: fixture.resources.affectedCi.impactScope,\n            },\n          ]\n        : []),\n    ];\n    const transports: NilesTransportEvidence[] = [];\n    for (const requirement of requirements) {\n      const result = await reader.call(this.liveDependencies().incidentAdapter, {\n        environment,\n        session,\n        tenantId: fixture.tenantId,\n        table: requirement.table,\n        field: requirement.field,\n        correlationId: this.liveCorrelation(\n          \`${'${correlationSeed}'}_choice_${'${requirement.table}'}_${'${requirement.field}'}\`,\n        ),\n      });\n      if (result.transport) transports.push(result.transport);\n      if (!result.values.includes(requirement.expected)) {\n        throw new LiveRunBlockedError(\n          'NILES_FIXTURE_CHOICE_UNSUPPORTED',\n          \`Configured ${'${requirement.table}'}.${'${requirement.field}'} value is not available in the tenant choice catalog.\`,\n          'ENVIRONMENT',\n        );\n      }\n    }\n    return transports;\n  }\n\n  private async pollSlaSummary(input: {\n    environment: EnvironmentDefinitionV1;\n    session: ActorSession;\n    tenantId: string;\n    incidentId: string;\n    correlationSeed: string;\n    accept: (summary: NilesSlaSummary) => boolean;\n  }): Promise<{ summary: NilesSlaSummary; transports: NilesTransportEvidence[] }> {\n    const live = this.liveDependencies();\n    const timeoutMs = Math.max(0, live.slaObservationTimeoutMs ?? 10_000);\n    const intervalMs = Math.max(0, live.slaObservationIntervalMs ?? 300);\n    const monotonic = live.monotonicClock ?? (() => Date.now());\n    const sleep = live.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));\n    const startedAt = monotonic();\n    const transports: NilesTransportEvidence[] = [];\n    let attempt = 0;\n    let summary: NilesSlaSummary | undefined;\n    do {\n      attempt += 1;\n      summary = await live.incidentAdapter.readSlaSummary({\n        environment: input.environment,\n        session: input.session,\n        tenantId: input.tenantId,\n        incidentId: input.incidentId,\n        correlationId: this.liveCorrelation(\`${'${input.correlationSeed}'}_${'${attempt}'}\`),\n      });\n      if (summary.transport) transports.push(summary.transport);\n      if (input.accept(summary) || monotonic() - startedAt >= timeoutMs) {\n        return { summary, transports };\n      }\n      await sleep(intervalMs);\n    } while (true);\n  }\n\n  private allowlistMatches(\n`,
    'core helpers',
  );

  source = replaceOnce(
    source,
    "        const verifiedResources = await Promise.all([",
    "        const choiceTransports = await this.verifyFixtureChoiceCompatibility(\n          environment,\n          fixture,\n          sessions.tenantAdmin,\n          'confirmed_readiness',\n        );\n        const verifiedResources = await Promise.all([",
    'confirmed choice validation call',
  );

  source = replaceOnce(
    source,
    "              ? 'Required fixture resources were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.'\n              : 'Required fixture resources were verified read-only.',",
    "              ? `Required fixture resources and ${choiceTransports.length} choice-catalog reads were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.`\n              : `Required fixture resources and ${choiceTransports.length} choice-catalog reads were verified read-only.`,",
    'confirmed choice validation message',
  );

  source = replaceOnce(
    source,
    "      const verifiedResources = await Promise.all([",
    "      await this.verifyFixtureChoiceCompatibility(\n        environment,\n        fixture,\n        sessions.tenantAdmin,\n        `${input.runId}_fixture`,\n      );\n      const verifiedResources = await Promise.all([",
    'live choice validation call',
  );

  const oldSlaRead = `                const summary = await live.incidentAdapter.readSlaSummary({\n                  environment,\n                  session: sessions!.serviceDesk,\n                  tenantId: fixture.tenantId,\n                  incidentId: incident.id,\n                  correlationId,\n                });\n                const observedObjectiveTypes = observedSlaObjectiveTypes(summary);\n                const requiredObjectiveTypes = fixture.resources.sla.objectiveTypes;\n                const phase =\n                  step.source.blueprintStepId === 'observe-held-sla' ? 'held' : 'active';`;
  const newSlaRead = `                const requiredObjectiveTypes = fixture.resources.sla.objectiveTypes;\n                const phase =\n                  step.source.blueprintStepId === 'observe-held-sla' ? 'held' : 'active';\n                const polled = await this.pollSlaSummary({\n                  environment,\n                  session: sessions!.serviceDesk,\n                  tenantId: fixture.tenantId,\n                  incidentId: incident.id,\n                  correlationSeed: \`${'${input.runId}'}_${'${phase}'}_sla\`,\n                  accept: (candidate) => {\n                    if (!fixture.resources.sla.required) return true;\n                    const observed = observedSlaObjectiveTypes(candidate);\n                    const objectivesPresent = requiredObjectiveTypes.every((objective) =>\n                      observed.has(objective),\n                    );\n                    return (\n                      objectivesPresent &&\n                      (phase === 'active'\n                        ? candidate.records.some((record) => isRunningSlaStatus(record.status))\n                        : candidate.records.some(isCurrentlyPaused))\n                    );\n                  },\n                });\n                const summary = polled.summary;\n                const observedObjectiveTypes = observedSlaObjectiveTypes(summary);`;
  source = replaceOnce(source, oldSlaRead, newSlaRead, 'active/held SLA polling');

  source = replaceOnce(
    source,
    "                  ...transportObservation(summary.transport),\n                  incidentId: incident.id,",
    "                  ...transportObservation(summary.transport),\n                  ...operationsEvidence(polled.transports),\n                  incidentId: incident.id,",
    'active/held SLA operations evidence',
  );

  const oldResume = `                const resumedSla = await live.incidentAdapter\n                  .readSlaSummary({\n                    environment,\n                    session: sessions!.serviceDesk,\n                    tenantId: fixture.tenantId,\n                    incidentId: incident.id,\n                    correlationId,\n                  })\n                  .catch((error: Error) => {\n                    throw attachOperationEvidence(error, [incident!.transport]);\n                  });`;
  const newResume = `                const resumedPoll = await this.pollSlaSummary({\n                  environment,\n                  session: sessions!.serviceDesk,\n                  tenantId: fixture.tenantId,\n                  incidentId: incident.id,\n                  correlationSeed: \`${'${input.runId}'}_resumed_sla\`,\n                  accept: (candidate) => {\n                    if (!fixture.resources.sla.required) return true;\n                    const observed = observedSlaObjectiveTypes(candidate);\n                    return (\n                      fixture.resources.sla.objectiveTypes.every((objective) =>\n                        observed.has(objective),\n                      ) && !candidate.records.some(isCurrentlyPaused)\n                    );\n                  },\n                }).catch((error: Error) => {\n                  throw attachOperationEvidence(error, [incident!.transport]);\n                });\n                const resumedSla = resumedPoll.summary;`;
  source = replaceOnce(source, oldResume, newResume, 'resume SLA polling');
  source = source.replaceAll(
    "...operationsEvidence([incident.transport, resumedSla.transport])",
    "...operationsEvidence([incident.transport, ...resumedPoll.transports])",
  );

  const oldResolve = `                const resolvedSla = await live.incidentAdapter\n                  .readSlaSummary({\n                    environment,\n                    session: sessions!.serviceDesk,\n                    tenantId: fixture.tenantId,\n                    incidentId: incident.id,\n                    correlationId,\n                  })\n                  .catch((error: Error) => {\n                    throw attachOperationEvidence(error, [incident!.transport]);\n                  });`;
  const newResolve = `                const resolvedPoll = await this.pollSlaSummary({\n                  environment,\n                  session: sessions!.serviceDesk,\n                  tenantId: fixture.tenantId,\n                  incidentId: incident.id,\n                  correlationSeed: \`${'${input.runId}'}_resolved_sla\`,\n                  accept: (candidate) => {\n                    if (!fixture.resources.sla.required) return true;\n                    const observed = observedSlaObjectiveTypes(candidate);\n                    return (\n                      fixture.resources.sla.objectiveTypes.every((objective) =>\n                        observed.has(objective),\n                      ) && candidate.records.some(isStoppedResolutionSlaRecord)\n                    );\n                  },\n                }).catch((error: Error) => {\n                  throw attachOperationEvidence(error, [incident!.transport]);\n                });\n                const resolvedSla = resolvedPoll.summary;`;
  source = replaceOnce(source, oldResolve, newResolve, 'resolve SLA polling');
  source = source.replaceAll(
    "...operationsEvidence([incident.transport, resolvedSla.transport])",
    "...operationsEvidence([incident.transport, ...resolvedPoll.transports])",
  );
  return source;
});

await edit('packages/adapter-niles/src/index.ts', (source) => {
  const marker = "  createIncident(input: {\n";
  const method = `  readChoiceValues(input: {\n    environment: EnvironmentDefinitionV1;\n    session: ActorSession;\n    tenantId: string;\n    table: 'itsm_incidents' | 'itsm_incident_ci';\n    field: 'pendingReason' | 'relationshipType' | 'impactScope';\n    correlationId: string;\n  }): Promise<{ values: string[]; transport?: NilesTransportEvidence }> {\n    const query = new URLSearchParams({ table: input.table, field: input.field });\n    return this.request({\n      ...input,\n      method: 'GET',\n      path: \`/grc/itsm/choices?${'${query.toString()}'}\`,\n      pathTemplate: '/grc/itsm/choices?table=:table&field=:field',\n      operation: \`read ${'${input.table}'}.${'${input.field}'} choices\`,\n    }).then((response) => ({\n      values: asArrayPayload(response.payload).flatMap((entry) => {\n        const value = safeString(asRecord(entry)?.['value']);\n        return value ? [value] : [];\n      }),\n      transport: response.transport,\n    }));\n  }\n\n`;
  return replaceOnce(source, marker, method + marker, 'choice adapter method');
});

await edit('packages/contracts/src/index.ts', (source) => {
  source = source.replace("relationshipType: z.string().min(1).max(80).default('affected')", "relationshipType: z.string().min(1).max(80).default('affected_by')");
  source = source.replace(".default({ relationshipType: 'affected', impactScope: 'service-impact' })", ".default({ relationshipType: 'affected_by', impactScope: 'service_impacting' })");
  return source;
});

await edit('config/fixtures/niles-incident.staging.example.yaml', (source) =>
  source
    .replace('relationshipType: affected', 'relationshipType: affected_by')
    .replace('impactScope: service-impact', 'impactScope: service_impacting')
    .replace('pendingReason: external_provider', 'pendingReason: pending_external_dependency'),
);

await edit('tests/niles-incident-adapter.test.ts', (source) => {
  const anchor = "  it('classifies a real HTTP 502 as retryable upstream failure rather than malformed response', async () => {";
  const test = `  it('reads tenant choice values from a wrapped GRC array envelope', async () => {\n    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(\n      new Response(\n        JSON.stringify({\n          success: true,\n          data: [\n            { value: 'pending_vendor', label: 'Pending vendor' },\n            { value: 'pending_external_dependency', label: 'Pending external dependency' },\n          ],\n        }),\n        { status: 200 },\n      ),\n    );\n    const adapter = new NilesIncidentApiAdapter(fetchImplementation, 100);\n    const result = await adapter.readChoiceValues({\n      environment,\n      session,\n      tenantId,\n      table: 'itsm_incidents',\n      field: 'pendingReason',\n      correlationId: 'choice_catalog',\n    });\n    expect(result.values).toEqual(['pending_vendor', 'pending_external_dependency']);\n    expect(result.transport).toMatchObject({\n      method: 'GET',\n      pathTemplate: '/grc/itsm/choices?table=:table&field=:field',\n      httpStatus: 200,\n    });\n  });\n\n`;
  return replaceOnce(source, anchor, test + anchor, 'choice adapter regression');
});

await edit('tests/live-incident.test.ts', (source) => {
  const anchor = "  it('keeps ambiguous incident create outcomes recovery-required without claiming no incident exists', async () => {";
  const malformedTest = `  it('keeps a committed create with malformed 201 response recovery-required', async () => {\n    class MalformedCreateError extends Error {\n      readonly code = 'NILES_MALFORMED_RESPONSE';\n      readonly category = 'ADAPTER';\n      readonly retryable = false;\n      readonly transport = {\n        method: 'POST' as const,\n        pathTemplate: '/grc/itsm/incidents',\n        httpStatus: 201,\n        durationMs: 4,\n        correlationId: 'create_malformed_201',\n      };\n    }\n    class MalformedCreateAdapter extends StatefulIncidentAdapter {\n      serverSideCreateSideEffect = false;\n      override async createIncident(): Promise<NilesIncidentRecord> {\n        this.operations.push('POST create incident');\n        this.serverSideCreateSideEffect = true;\n        throw new MalformedCreateError('201 response did not contain an incident UUID');\n      }\n    }\n    const adapter = new MalformedCreateAdapter();\n    const core = buildCore(adapter);\n    await expect(\n      core.createLiveApiRun({\n        runId: 'live-malformed-create',\n        environmentId: 'live-test',\n        scenarioId: 'payment-api-service-degradation',\n        variationValues: { journey: 'normal' },\n        confirmRealMutation: true,\n        now: '2026-07-15T12:00:00.000Z',\n      }),\n    ).rejects.toMatchObject({ code: 'NILES_CREATE_OUTCOME_UNKNOWN' });\n    expect(adapter.serverSideCreateSideEffect).toBe(true);\n    await expect(core.getRunProgress('live-malformed-create')).resolves.toMatchObject({\n      status: 'RECOVERY_REQUIRED',\n      checkpoint: { error: { code: 'NILES_CREATE_OUTCOME_UNKNOWN' } },\n    });\n  });\n\n`;
  source = replaceOnce(source, anchor, malformedTest + anchor, 'malformed create regression');

  const optionalAnchor = "  it('finalizes a PASS run when optional SLA evidence is not observed', async () => {";
  const pollingTest = `  it('polls read-only SLA state until asynchronous hold, resume, and resolve posture is observable', async () => {\n    class EventuallyConsistentSlaAdapter extends StatefulIncidentAdapter {\n      readsByStatus = new Map<string, number>();\n      override async readSlaSummary(): Promise<NilesSlaSummary> {\n        const status = this.incident.status;\n        const reads = (this.readsByStatus.get(status) ?? 0) + 1;\n        this.readsByStatus.set(status, reads);\n        const effectiveStatus =\n          reads === 1 && status === 'on_hold'\n            ? 'IN_PROGRESS'\n            : reads === 1 && status === 'in_progress' && this.readsByStatus.has('on_hold')\n              ? 'PAUSED'\n              : reads === 1 && status === 'resolved'\n                ? 'IN_PROGRESS'\n                : status === 'on_hold'\n                  ? 'PAUSED'\n                  : status === 'resolved'\n                    ? 'COMPLETED'\n                    : 'IN_PROGRESS';\n        return {\n          transport: {\n            method: 'GET',\n            pathTemplate: '/grc/itsm/sla/records/INCIDENT/:incidentId',\n            httpStatus: 200,\n            durationMs: 1,\n            correlationId: \`sla_${'${status}'}_${'${reads}'}\`,\n          },\n          records: [\n            { id: 'sla-response', objectiveType: 'response', status: effectiveStatus },\n            {\n              id: 'sla-resolution',\n              objectiveType: 'resolution',\n              status: effectiveStatus,\n              ...(effectiveStatus === 'PAUSED' ? { pauseAt: '2026-07-15T12:00:00.000Z' } : {}),\n              ...(effectiveStatus === 'COMPLETED'\n                ? { stopAt: '2026-07-15T12:00:01.000Z' }\n                : {}),\n            },\n          ],\n        };\n      }\n    }\n    const adapter = new EventuallyConsistentSlaAdapter();\n    const core = buildCore(\n      adapter,\n      liveEnvironment,\n      {},\n      undefined,\n      {},\n      fixture,\n      undefined,\n      { slaObservationTimeoutMs: 100, slaObservationIntervalMs: 0, sleep: async () => {} },\n    );\n    const run = await core.createLiveApiRun({\n      runId: 'live-eventual-sla',\n      environmentId: 'live-test',\n      scenarioId: 'payment-api-service-degradation',\n      variationValues: { journey: 'normal' },\n      confirmRealMutation: true,\n      now: '2026-07-15T12:00:00.000Z',\n    });\n    expect(run.verdict).toBe('BLOCKED');\n    expect(adapter.readsByStatus.get('on_hold')).toBeGreaterThan(1);\n    expect(adapter.readsByStatus.get('resolved')).toBeGreaterThan(1);\n  });\n\n`;
  return replaceOnce(source, optionalAnchor, pollingTest + optionalAnchor, 'SLA polling regression');
});

await rm('.github/scripts/m1-02b-finalize.mjs');
await rm('.github/workflows/m1-02b-finalize.yml');
