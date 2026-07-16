from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one target in {path}, found {count}")
    p.write_text(text.replace(old, new, 1))


core = "packages/core/src/index.ts"
replace_once(
    core,
    """  readSlaSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesSlaSummary>;""",
    """  readSlaSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationId: string;
  }): Promise<NilesSlaSummary>;
  readChoiceValues?(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    table: 'itsm_incidents' | 'itsm_incident_ci';
    field: 'pendingReason' | 'relationshipType' | 'impactScope';
    correlationId: string;
  }): Promise<{ values: string[]; transport?: NilesTransportEvidence }>;""",
    "choice read port",
)
replace_once(
    core,
    "  backgroundCoordinator?: (operation: () => Promise<void>) => void;\n}",
    """  backgroundCoordinator?: (operation: () => Promise<void>) => void;
  slaObservationTimeoutMs?: number;
  slaObservationIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}""",
    "polling dependencies",
)
replace_once(
    core,
    "  'NILES_UPSTREAM_FAILURE',\n  'NILES_LIVE_ADAPTER_FAILURE',",
    "  'NILES_UPSTREAM_FAILURE',\n  'NILES_LIVE_ADAPTER_FAILURE',\n  'NILES_MALFORMED_RESPONSE',",
    "malformed create ambiguity",
)

helpers = r'''  private async verifyFixtureChoiceCompatibility(
    environment: EnvironmentDefinitionV1,
    fixture: NilesIncidentFixtureV1,
    session: ActorSession,
    correlationSeed: string,
  ): Promise<NilesTransportEvidence[]> {
    const reader = this.liveDependencies().incidentAdapter.readChoiceValues;
    if (!reader) {
      throw new LiveRunBlockedError(
        'NILES_FIXTURE_CHOICE_READ_UNAVAILABLE',
        'The NILES adapter does not expose the read-only choice catalog required for fixture compatibility verification.',
        'ENVIRONMENT',
      );
    }
    const requirements = [
      {
        table: 'itsm_incidents' as const,
        field: 'pendingReason' as const,
        expected: fixture.resources.hold.pendingReason,
      },
      {
        table: 'itsm_incident_ci' as const,
        field: 'relationshipType' as const,
        expected: fixture.resources.affectedCi.relationshipType,
      },
      ...(fixture.resources.affectedCi.impactScope
        ? [
            {
              table: 'itsm_incident_ci' as const,
              field: 'impactScope' as const,
              expected: fixture.resources.affectedCi.impactScope,
            },
          ]
        : []),
    ];
    const transports: NilesTransportEvidence[] = [];
    for (const requirement of requirements) {
      const result = await reader.call(this.liveDependencies().incidentAdapter, {
        environment,
        session,
        tenantId: fixture.tenantId,
        table: requirement.table,
        field: requirement.field,
        correlationId: this.liveCorrelation(
          `${correlationSeed}_choice_${requirement.table}_${requirement.field}`,
        ),
      });
      if (result.transport) transports.push(result.transport);
      if (!result.values.includes(requirement.expected)) {
        throw new LiveRunBlockedError(
          'NILES_FIXTURE_CHOICE_UNSUPPORTED',
          `Configured ${requirement.table}.${requirement.field} value is not available in the tenant choice catalog.`,
          'ENVIRONMENT',
        );
      }
    }
    return transports;
  }

  private async pollSlaSummary(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    incidentId: string;
    correlationSeed: string;
    accept: (summary: NilesSlaSummary) => boolean;
  }): Promise<{ summary: NilesSlaSummary; transports: NilesTransportEvidence[] }> {
    const live = this.liveDependencies();
    const timeoutMs = Math.max(0, live.slaObservationTimeoutMs ?? 10_000);
    const intervalMs = Math.max(0, live.slaObservationIntervalMs ?? 300);
    const monotonic = live.monotonicClock ?? (() => Date.now());
    const sleep =
      live.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const startedAt = monotonic();
    const transports: NilesTransportEvidence[] = [];
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const summary = await live.incidentAdapter.readSlaSummary({
        environment: input.environment,
        session: input.session,
        tenantId: input.tenantId,
        incidentId: input.incidentId,
        correlationId: this.liveCorrelation(`${input.correlationSeed}_${attempt}`),
      });
      if (summary.transport) transports.push(summary.transport);
      if (input.accept(summary) || monotonic() - startedAt >= timeoutMs) {
        return { summary, transports };
      }
      await sleep(intervalMs);
    }
  }

'''
replace_once(core, "  private allowlistMatches(\n", helpers + "  private allowlistMatches(\n", "core helpers")

replace_once(
    core,
    "        const verifiedResources = await Promise.all([",
    """        const choiceTransports = await this.verifyFixtureChoiceCompatibility(
          environment,
          fixture,
          sessions.tenantAdmin,
          'confirmed_readiness',
        );
        const verifiedResources = await Promise.all([""",
    "confirmed choice validation",
)
replace_once(
    core,
    """              ? 'Required fixture resources were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.'
              : 'Required fixture resources were verified read-only.',""",
    """              ? `Required fixture resources and ${choiceTransports.length} choice-catalog reads were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.`
              : `Required fixture resources and ${choiceTransports.length} choice-catalog reads were verified read-only.`,""",
    "confirmed readiness message",
)
replace_once(
    core,
    "      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);\n      const verifiedResources = await Promise.all([",
    """      sessions = await this.authenticateLiveActors(environment, fixture, input.runId);
      await this.verifyFixtureChoiceCompatibility(
        environment,
        fixture,
        sessions.tenantAdmin,
        `${input.runId}_fixture`,
      );
      const verifiedResources = await Promise.all([""",
    "live choice validation",
)

old = """                const summary = await live.incidentAdapter.readSlaSummary({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationId,
                });
                const observedObjectiveTypes = observedSlaObjectiveTypes(summary);
                const requiredObjectiveTypes = fixture.resources.sla.objectiveTypes;
                const phase =
                  step.source.blueprintStepId === 'observe-held-sla' ? 'held' : 'active';"""
new = """                const requiredObjectiveTypes = fixture.resources.sla.objectiveTypes;
                const phase =
                  step.source.blueprintStepId === 'observe-held-sla' ? 'held' : 'active';
                const polled = await this.pollSlaSummary({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationSeed: `${input.runId}_${phase}_sla`,
                  accept: (candidate) => {
                    if (!fixture.resources.sla.required) return true;
                    const observed = observedSlaObjectiveTypes(candidate);
                    const objectivesPresent = requiredObjectiveTypes.every((objective) =>
                      observed.has(objective),
                    );
                    return (
                      objectivesPresent &&
                      (phase === 'active'
                        ? candidate.records.some((record) => isRunningSlaStatus(record.status))
                        : candidate.records.some(isCurrentlyPaused))
                    );
                  },
                });
                const summary = polled.summary;
                const observedObjectiveTypes = observedSlaObjectiveTypes(summary);"""
replace_once(core, old, new, "active held polling")
replace_once(
    core,
    "                const slaEvidence = {\n                  ...transportObservation(summary.transport),\n                  incidentId: incident.id,",
    "                const slaEvidence = {\n                  ...transportObservation(summary.transport),\n                  ...operationsEvidence(polled.transports),\n                  incidentId: incident.id,",
    "active held evidence",
)

old_resume = """                const resumedSla = await live.incidentAdapter
                  .readSlaSummary({
                    environment,
                    session: sessions!.serviceDesk,
                    tenantId: fixture.tenantId,
                    incidentId: incident.id,
                    correlationId,
                  })
                  .catch((error: Error) => {
                    throw attachOperationEvidence(error, [incident!.transport]);
                  });"""
new_resume = """                const resumedPoll = await this.pollSlaSummary({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationSeed: `${input.runId}_resumed_sla`,
                  accept: (candidate) => {
                    if (!fixture.resources.sla.required) return true;
                    const observed = observedSlaObjectiveTypes(candidate);
                    return (
                      fixture.resources.sla.objectiveTypes.every((objective) =>
                        observed.has(objective),
                      ) && !candidate.records.some(isCurrentlyPaused)
                    );
                  },
                }).catch((error: Error) => {
                  throw attachOperationEvidence(error, [incident!.transport]);
                });
                const resumedSla = resumedPoll.summary;"""
replace_once(core, old_resume, new_resume, "resume polling")
p = Path(core)
text = p.read_text().replace(
    "...operationsEvidence([incident.transport, resumedSla.transport])",
    "...operationsEvidence([incident.transport, ...resumedPoll.transports])",
)
p.write_text(text)

old_resolve = """                const resolvedSla = await live.incidentAdapter
                  .readSlaSummary({
                    environment,
                    session: sessions!.serviceDesk,
                    tenantId: fixture.tenantId,
                    incidentId: incident.id,
                    correlationId,
                  })
                  .catch((error: Error) => {
                    throw attachOperationEvidence(error, [incident!.transport]);
                  });"""
new_resolve = """                const resolvedPoll = await this.pollSlaSummary({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  correlationSeed: `${input.runId}_resolved_sla`,
                  accept: (candidate) => {
                    if (!fixture.resources.sla.required) return true;
                    const observed = observedSlaObjectiveTypes(candidate);
                    return (
                      fixture.resources.sla.objectiveTypes.every((objective) =>
                        observed.has(objective),
                      ) && candidate.records.some(isStoppedResolutionSlaRecord)
                    );
                  },
                }).catch((error: Error) => {
                  throw attachOperationEvidence(error, [incident!.transport]);
                });
                const resolvedSla = resolvedPoll.summary;"""
replace_once(core, old_resolve, new_resolve, "resolve polling")
p = Path(core)
text = p.read_text().replace(
    "...operationsEvidence([incident.transport, resolvedSla.transport])",
    "...operationsEvidence([incident.transport, ...resolvedPoll.transports])",
)
p.write_text(text)

adapter = "packages/adapter-niles/src/index.ts"
choice_method = r'''  readChoiceValues(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    table: 'itsm_incidents' | 'itsm_incident_ci';
    field: 'pendingReason' | 'relationshipType' | 'impactScope';
    correlationId: string;
  }): Promise<{ values: string[]; transport?: NilesTransportEvidence }> {
    const query = new URLSearchParams({ table: input.table, field: input.field });
    return this.request({
      ...input,
      method: 'GET',
      path: `/grc/itsm/choices?${query.toString()}`,
      pathTemplate: '/grc/itsm/choices?table=:table&field=:field',
      operation: `read ${input.table}.${input.field} choices`,
    }).then((response) => ({
      values: asArrayPayload(response.payload).flatMap((entry) => {
        const value = safeString(asRecord(entry)?.['value']);
        return value ? [value] : [];
      }),
      transport: response.transport,
    }));
  }

'''
replace_once(adapter, "  createIncident(input: {\n", choice_method + "  createIncident(input: {\n", "choice adapter")

contracts = Path("packages/contracts/src/index.ts")
text = contracts.read_text()
text = text.replace("relationshipType: z.string().min(1).max(80).default('affected')", "relationshipType: z.string().min(1).max(80).default('affected_by')")
text = text.replace(".default({ relationshipType: 'affected', impactScope: 'service-impact' })", ".default({ relationshipType: 'affected_by', impactScope: 'service_impacting' })")
contracts.write_text(text)

fixture = Path("fixtures/niles-incident/staging.example.yaml")
text = fixture.read_text().replace("relationshipType: affected", "relationshipType: affected_by").replace("impactScope: service-impact", "impactScope: service_impacting").replace("pendingReason: external_provider", "pendingReason: pending_external_dependency")
fixture.write_text(text)

test = Path("tests/live-incident.test.ts")
text = test.read_text().replace("affectedCi: { relationshipType: 'affected', impactScope: 'service-impact' }", "affectedCi: { relationshipType: 'affected_by', impactScope: 'service_impacting' }").replace("pendingReason: 'external_provider'", "pendingReason: 'pending_external_dependency'")
text = text.replace(
    "      correlationIdFactory: (seed) => `live_${seed.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,\n      ...(backgroundCoordinator ? { backgroundCoordinator } : {}),",
    """      correlationIdFactory: (seed) => `live_${seed.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      slaObservationTimeoutMs: 25,
      slaObservationIntervalMs: 1,
      sleep: async (milliseconds) => {
        if (milliseconds > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
        }
      },
      ...(backgroundCoordinator ? { backgroundCoordinator } : {}),""",
)
if "slaObservationTimeoutMs: 25" not in text:
    raise RuntimeError("test polling override target not found")
test.write_text(text)
