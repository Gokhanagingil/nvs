#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one exact match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, expected_minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < expected_minimum:
        raise RuntimeError(f"{path}: expected at least {expected_minimum} matches, found {count}")
    write(path, text.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str, *, flags: int = 0) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:160]!r}")
    write(path, next_text)


# Contracts: retain v1 compatibility for canonical UUID bindings while allowing the
# explicit legacy assignment label supported by the frozen NILES create/assign DTOs.
replace_once(
    "packages/contracts/src/index.ts",
    """const fixtureResourceRefSchema = z
  .object({
    id: z.uuid(),
    label: z.string().min(1).max(160).optional(),
  })
  .strict();
""",
    """const fixtureResourceRefSchema = z
  .object({
    id: z.uuid(),
    label: z.string().min(1).max(160).optional(),
  })
  .strict();

const fixtureAssignmentGroupSchema = z.union([
  z
    .object({
      mode: z.literal('CANONICAL_ID').optional(),
      id: z.uuid(),
      label: z.string().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('LEGACY_LABEL'),
      label: z.string().min(1).max(100),
    })
    .strict(),
]);
""",
)
replace_once(
    "packages/contracts/src/index.ts",
    "        assignmentGroup: fixtureResourceRefSchema,",
    "        assignmentGroup: fixtureAssignmentGroupSchema,",
)
replace_once(
    "packages/contracts/src/index.ts",
    "    kind: z.enum(['TENANT', 'ASSIGNMENT_GROUP', 'SERVICE', 'OFFERING', 'CI', 'INCIDENT', 'SLA']),",
    """    kind: z.enum([
      'TENANT',
      'ASSIGNMENT_GROUP',
      'ASSIGNMENT_LABEL',
      'SERVICE',
      'OFFERING',
      'CI',
      'INCIDENT',
      'SLA',
    ]),""",
)

# Core public port and normalized record shape.
replace_once(
    "packages/core/src/index.ts",
    """  requesterId?: string | null;
  assignmentGroupId?: string | null;
""",
    """  requesterId?: string | null;
  assignmentGroup?: string | null;
  assignmentGroupId?: string | null;
""",
)
replace_once(
    "packages/core/src/index.ts",
    """    requesterUserId: string;
    assignmentGroupId: string;
    serviceId: string;
""",
    """    requesterUserId: string;
    assignmentGroupId?: string;
    assignmentGroup?: string;
    serviceId: string;
""",
)
replace_once(
    "packages/core/src/index.ts",
    """    incidentId: string;
    assignmentGroupId: string;
    correlationId: string;
""",
    """    incidentId: string;
    assignmentGroupId?: string;
    assignmentGroup?: string;
    correlationId: string;
""",
)
replace_once(
    "packages/core/src/index.ts",
    """function incidentCreateMarker(runId: string, runNamespacePrefix: string): string {
  return `${runNamespacePrefix}-${runId}`;
}
""",
    """function incidentCreateMarker(runId: string, runNamespacePrefix: string): string {
  return `${runNamespacePrefix}-${runId}`;
}

type FixtureAssignmentBinding =
  | {
      mode: 'CANONICAL_ID';
      assignmentGroupId: string;
      label?: string;
    }
  | {
      mode: 'LEGACY_LABEL';
      assignmentGroup: string;
      label: string;
    };

function fixtureAssignmentBinding(fixture: NilesIncidentFixtureV1): FixtureAssignmentBinding {
  const assignmentGroup = fixture.resources.assignmentGroup;
  if ('id' in assignmentGroup) {
    return {
      mode: 'CANONICAL_ID',
      assignmentGroupId: assignmentGroup.id,
      ...(assignmentGroup.label ? { label: assignmentGroup.label } : {}),
    };
  }
  return {
    mode: 'LEGACY_LABEL',
    assignmentGroup: assignmentGroup.label,
    label: assignmentGroup.label,
  };
}

function fixtureAssignmentInput(binding: FixtureAssignmentBinding): {
  assignmentGroupId?: string;
  assignmentGroup?: string;
} {
  return binding.mode === 'CANONICAL_ID'
    ? { assignmentGroupId: binding.assignmentGroupId }
    : { assignmentGroup: binding.assignmentGroup };
}

function fixtureAssignmentInventoryResource(
  fixture: NilesIncidentFixtureV1,
): ResourceInventoryV1['resources'][number] {
  const binding = fixtureAssignmentBinding(fixture);
  return binding.mode === 'CANONICAL_ID'
    ? {
        kind: 'ASSIGNMENT_GROUP',
        id: binding.assignmentGroupId,
        ...(binding.label ? { label: binding.label } : {}),
        disposition: 'VERIFIED_EXISTING',
      }
    : {
        kind: 'ASSIGNMENT_LABEL',
        id: `legacy-label:${binding.assignmentGroup}`,
        label: binding.label,
        disposition: 'VERIFIED_EXISTING',
      };
}
""",
)

# Inventory occurrences are identical apart from indentation.
core_path = "packages/core/src/index.ts"
core_text = read(core_path)
assignment_inventory_pattern = re.compile(
    r"(?m)^(?P<indent>\s*)\{\n"
    r"(?P=indent)  kind: 'ASSIGNMENT_GROUP',\n"
    r"(?P=indent)  id: fixture\.resources\.assignmentGroup\.id,\n"
    r"(?P=indent)  label: fixture\.resources\.assignmentGroup\.label,\n"
    r"(?P=indent)  disposition: 'VERIFIED_EXISTING',\n"
    r"(?P=indent)\},"
)
core_text, inventory_count = assignment_inventory_pattern.subn(
    lambda match: f"{match.group('indent')}fixtureAssignmentInventoryResource(fixture),",
    core_text,
)
if inventory_count != 2:
    raise RuntimeError(f"{core_path}: expected two assignment inventory blocks, found {inventory_count}")
write(core_path, core_text)

# Confirmed readiness: verify a canonical group UUID when present; otherwise rely on
# the reviewed legacy-label DTO contract and continue with the remaining resources.
replace_once(
    core_path,
    """        const choiceTransports = await this.verifyFixtureChoiceCompatibility(
          environment,
          fixture,
          sessions.tenantAdmin,
          'confirmed_readiness',
        );
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
""",
    """        const choiceTransports = await this.verifyFixtureChoiceCompatibility(
          environment,
          fixture,
          sessions.tenantAdmin,
          'confirmed_readiness',
        );
        const assignmentBinding = fixtureAssignmentBinding(fixture);
        const verifiedResources = await Promise.all([
          ...(assignmentBinding.mode === 'CANONICAL_ID'
            ? [
                live.incidentAdapter.verifyResource({
                  environment,
                  session: sessions.tenantAdmin,
                  tenantId: fixture.tenantId,
                  kind: 'ASSIGNMENT_GROUP' as const,
                  id: assignmentBinding.assignmentGroupId,
                  correlationId: this.liveCorrelation('confirmed_readiness_fixture_group'),
                }),
              ]
            : []),
          live.incidentAdapter.verifyResource({
""",
)
replace_once(
    core_path,
    """            fixture.resources.sla.policyRef
              ? `Required fixture resources and ${choiceTransports.length} choice-catalog reads were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.`
              : `Required fixture resources and ${choiceTransports.length} choice-catalog reads were verified read-only.`,
""",
    """            fixture.resources.sla.policyRef
              ? `Required fixture resources, ${choiceTransports.length} choice-catalog reads, and ${assignmentBinding.mode === 'LEGACY_LABEL' ? 'the reviewed legacy assignment-label contract' : 'the canonical assignment group'} were verified read-only; SLA policyRef remains observational because no stable read-only policy endpoint is contracted.`
              : `Required fixture resources, ${choiceTransports.length} choice-catalog reads, and ${assignmentBinding.mode === 'LEGACY_LABEL' ? 'the reviewed legacy assignment-label contract' : 'the canonical assignment group'} were verified read-only.`,
""",
)

# Runtime fixture verification block.
replace_once(
    core_path,
    """      await this.verifyFixtureChoiceCompatibility(
        environment,
        fixture,
        sessions.tenantAdmin,
        `${input.runId}_fixture`,
      );
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
""",
    """      await this.verifyFixtureChoiceCompatibility(
        environment,
        fixture,
        sessions.tenantAdmin,
        `${input.runId}_fixture`,
      );
      const assignmentBinding = fixtureAssignmentBinding(fixture);
      const verifiedResources = await Promise.all([
        ...(assignmentBinding.mode === 'CANONICAL_ID'
          ? [
              live.incidentAdapter.verifyResource({
                environment,
                session: sessions.tenantAdmin,
                tenantId: fixture.tenantId,
                kind: 'ASSIGNMENT_GROUP' as const,
                id: assignmentBinding.assignmentGroupId,
                correlationId: this.liveCorrelation(`${input.runId}_fixture_group`),
              }),
            ]
          : []),
        live.incidentAdapter.verifyResource({
""",
)

# The create step binds either a canonical UUID or the explicit legacy label.
replace_once(
    core_path,
    """              case 'incident.report': {
                const marker = incidentCreateMarker(input.runId, fixture.runNamespacePrefix);
                try {
""",
    """              case 'incident.report': {
                const marker = incidentCreateMarker(input.runId, fixture.runNamespacePrefix);
                const assignmentBinding = fixtureAssignmentBinding(fixture);
                try {
""",
)
replace_once(
    core_path,
    "                    assignmentGroupId: fixture.resources.assignmentGroup.id,",
    "                    ...fixtureAssignmentInput(assignmentBinding),",
)

# Replace the complete assignment step so the oracle remains deterministic for both
# canonical and legacy-label bindings.
regex_once(
    core_path,
    r"              case 'incident\.assign': \{.*?\n              \}\n              case 'incident\.take_ownership': \{",
    """              case 'incident.assign': {
                if (!incident)
                  throw new LiveStepError(
                    typedError(
                      'ASSERTION',
                      'INCIDENT_NOT_CREATED',
                      'The incident must exist before assignment.',
                    ),
                  );
                const assignmentBinding = fixtureAssignmentBinding(fixture);
                incident = await live.incidentAdapter.assignIncident({
                  environment,
                  session: sessions!.serviceDesk,
                  tenantId: fixture.tenantId,
                  incidentId: incident.id,
                  ...fixtureAssignmentInput(assignmentBinding),
                  correlationId,
                });
                const assignmentMatches =
                  assignmentBinding.mode === 'CANONICAL_ID'
                    ? incident.assignmentGroupId === assignmentBinding.assignmentGroupId
                    : incident.assignmentGroup === assignmentBinding.assignmentGroup;
                requireLiveAssertionWithEvidence(
                  assignmentMatches,
                  assignmentBinding.mode === 'CANONICAL_ID'
                    ? 'INCIDENT_ASSIGNMENT_GROUP_MISMATCH'
                    : 'INCIDENT_ASSIGNMENT_LABEL_MISMATCH',
                  assignmentBinding.mode === 'CANONICAL_ID'
                    ? 'The incident assignment group does not match the configured fixture.'
                    : 'The incident assignment label does not match the configured fixture.',
                  {
                    ...transportObservation(incident.transport),
                    incidentId: incident.id,
                    assignmentBindingMode: assignmentBinding.mode,
                    assignmentGroupId: incident.assignmentGroupId ?? null,
                    assignmentGroup: incident.assignmentGroup ?? null,
                    expectedAssignmentGroupId:
                      assignmentBinding.mode === 'CANONICAL_ID'
                        ? assignmentBinding.assignmentGroupId
                        : null,
                    expectedAssignmentGroup:
                      assignmentBinding.mode === 'LEGACY_LABEL'
                        ? assignmentBinding.assignmentGroup
                        : null,
                  },
                );
                return {
                  ...transportObservation(incident.transport),
                  incidentId: incident.id,
                  assignmentBindingMode: assignmentBinding.mode,
                  assignmentGroupId: incident.assignmentGroupId ?? null,
                  assignmentGroup: incident.assignmentGroup ?? null,
                };
              }
              case 'incident.take_ownership': {""",
    flags=re.DOTALL,
)

# Adapter: normalize and write either assignment representation.
replace_once(
    "packages/adapter-niles/src/index.ts",
    """  const requesterId = safeString(payload?.['requesterId']);
  const assignmentGroupId = safeString(payload?.['assignmentGroupId']);
""",
    """  const requesterId = safeString(payload?.['requesterId']);
  const assignmentGroup = safeString(payload?.['assignmentGroup']);
  const assignmentGroupId = safeString(payload?.['assignmentGroupId']);
""",
)
replace_once(
    "packages/adapter-niles/src/index.ts",
    """  if (requesterId) incident.requesterId = requesterId;
  if (assignmentGroupId) incident.assignmentGroupId = assignmentGroupId;
""",
    """  if (requesterId) incident.requesterId = requesterId;
  if (assignmentGroup) incident.assignmentGroup = assignmentGroup;
  if (assignmentGroupId) incident.assignmentGroupId = assignmentGroupId;
""",
)
replace_once(
    "packages/adapter-niles/src/index.ts",
    """function asArrayPayload(value: unknown): unknown[] {
  const payload = unwrapPayload(value);
  if (Array.isArray(payload)) {
    return payload;
  }
  const items = asRecord(payload)?.['items'];
  if (Array.isArray(items)) {
    return items;
  }
  return [];
}
""",
    """function asArrayPayload(value: unknown): unknown[] {
  const payload = unwrapPayload(value);
  if (Array.isArray(payload)) {
    return payload;
  }
  const items = asRecord(payload)?.['items'];
  if (Array.isArray(items)) {
    return items;
  }
  return [];
}

function assignmentPayload(input: {
  assignmentGroupId?: string;
  assignmentGroup?: string;
}): { assignmentGroupId: string } | { assignmentGroup: string } {
  if (input.assignmentGroupId) {
    return { assignmentGroupId: input.assignmentGroupId };
  }
  if (input.assignmentGroup) {
    return { assignmentGroup: input.assignmentGroup };
  }
  throw new NilesLiveAdapterOperationError(
    undefined,
    'build assignment payload',
    undefined,
    'malformed',
  );
}
""",
)
replace_once(
    "packages/adapter-niles/src/index.ts",
    """    requesterUserId: string;
    assignmentGroupId: string;
    serviceId: string;
""",
    """    requesterUserId: string;
    assignmentGroupId?: string;
    assignmentGroup?: string;
    serviceId: string;
""",
)
replace_once(
    "packages/adapter-niles/src/index.ts",
    "        assignmentGroupId: input.assignmentGroupId,",
    "        ...assignmentPayload(input),",
)
replace_once(
    "packages/adapter-niles/src/index.ts",
    """    incidentId: string;
    assignmentGroupId: string;
    correlationId: string;
""",
    """    incidentId: string;
    assignmentGroupId?: string;
    assignmentGroup?: string;
    correlationId: string;
""",
)
replace_once(
    "packages/adapter-niles/src/index.ts",
    "      body: { assignmentGroupId: input.assignmentGroupId },",
    "      body: assignmentPayload(input),",
)

# The committed example remains canonical and documents its binding mode.
replace_once(
    "fixtures/niles-incident/staging.example.yaml",
    """  assignmentGroup:
    id: 44444444-4444-4444-8444-444444444444
""",
    """  assignmentGroup:
    mode: CANONICAL_ID
    id: 44444444-4444-4444-8444-444444444444
""",
)

# Planner: when the tenant truly contains no active groups, use the explicit legacy
# label supported by NILES instead of creating shared staging data.
replace_once(
    "ops/staging-fixture-plan.py",
    """    if len(active) == 1:
        _validate_uuid("assignment group", active[0])
        return active[0], len(candidates), "SOLE_ACTIVE_FALLBACK"

    scored = [(_assignment_group_score(item), item) for item in active]
""",
    """    if len(active) == 1:
        _validate_uuid("assignment group", active[0])
        return active[0], len(candidates), "SOLE_ACTIVE_FALLBACK"
    if len(active) == 0:
        return (
            {"mode": "LEGACY_LABEL", "label": "NVS Service Desk"},
            len(candidates),
            "LEGACY_LABEL_FALLBACK",
        )

    scored = [(_assignment_group_score(item), item) for item in active]
""",
)
replace_once(
    "ops/staging-fixture-plan.py",
    """def _selection(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "label": item.get("name") or "Selected staging record",
""",
    """def _selection(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "label": item.get("name") or "Selected staging record",
""",
)
# Insert the specialized assignment selection immediately after the generic helper.
regex_once(
    "ops/staging-fixture-plan.py",
    r"(def _selection\(item: dict\[str, Any\]\) -> dict\[str, Any\]:.*?\n    \}\n)\n\ndef _run",
    r"\1\n\ndef _assignment_selection(item: dict[str, Any], mode: str) -> dict[str, Any]:\n    if mode == \"LEGACY_LABEL_FALLBACK\":\n        label = item.get(\"label\")\n        if not isinstance(label, str) or not label.strip() or len(label) > 100:\n            raise PlanError(\"legacy assignment label is invalid.\")\n        return {\"mode\": \"LEGACY_LABEL\", \"label\": label}\n    return {\"mode\": \"CANONICAL_ID\", **_selection(item)}\n\n\ndef _run",
    flags=re.DOTALL,
)
replace_once(
    "ops/staging-fixture-plan.py",
    '            "assignmentGroup": _selection(group),',
    '            "assignmentGroup": _assignment_selection(group, group_mode),',
)

# Apply: validate and render the discriminated assignment binding.
replace_once(
    "ops/staging-fixture-apply.py",
    """def _render_fixture(proposal: dict[str, Any]) -> str:
""",
    """def _selected_assignment_group(proposal: dict[str, Any]) -> dict[str, Any]:
    selected = proposal.get("selected")
    item = selected.get("assignmentGroup") if isinstance(selected, dict) else None
    if not isinstance(item, dict):
        raise ApplyError("fixture proposal is missing selected assignmentGroup.")
    mode = item.get("mode")
    label = item.get("label")
    if not isinstance(label, str) or not label.strip() or len(label) > 160:
        raise ApplyError("fixture proposal assignmentGroup label is invalid.")
    if mode == "LEGACY_LABEL":
        if len(label) > 100 or "id" in item:
            raise ApplyError("legacy assignmentGroup proposal is invalid.")
        return item
    if mode != "CANONICAL_ID":
        raise ApplyError("fixture proposal assignmentGroup mode is invalid.")
    identifier = item.get("id")
    if not isinstance(identifier, str) or not UUID.fullmatch(identifier):
        raise ApplyError("fixture proposal assignmentGroup UUID is invalid.")
    return item


def _render_fixture(proposal: dict[str, Any]) -> str:
""",
)
replace_once(
    "ops/staging-fixture-apply.py",
    '    group = _selected(proposal, "assignmentGroup")',
    '    group = _selected_assignment_group(proposal)',
)
replace_once(
    "ops/staging-fixture-apply.py",
    """            "  assignmentGroup:",
            f"    id: {group['id']}",
            f"    label: {_yaml_string(group['label'])}",
""",
    """            "  assignmentGroup:",
            f"    mode: {group['mode']}",
            *(
                [f"    id: {group['id']}"]
                if group["mode"] == "CANONICAL_ID"
                else []
            ),
            f"    label: {_yaml_string(group['label'])}",
""",
)

# Tests: keep the canonical fixture explicit and adapt the stateful fake to both
# assignment representations.
replace_once(
    "tests/live-incident.test.ts",
    """const tenantId = '33333333-3333-4333-8333-333333333333';
const userIds = {
""",
    """const tenantId = '33333333-3333-4333-8333-333333333333';
const assignmentGroupId = '55555555-5555-4555-8555-555555555555';
const userIds = {
""",
)
replace_once(
    "tests/live-incident.test.ts",
    "    assignmentGroup: { id: '55555555-5555-4555-8555-555555555555' },",
    "    assignmentGroup: { mode: 'CANONICAL_ID', id: assignmentGroupId },",
)
replace_all(
    "tests/live-incident.test.ts",
    "fixture.resources.assignmentGroup.id",
    "assignmentGroupId",
    expected_minimum=2,
)
replace_once(
    "tests/live-incident.test.ts",
    """  async createIncident(): Promise<NilesIncidentRecord> {
    this.operations.push('POST create incident');
    return {
      ...this.incident,
""",
    """  async createIncident(input: {
    assignmentGroupId?: string;
    assignmentGroup?: string;
  }): Promise<NilesIncidentRecord> {
    this.operations.push('POST create incident');
    this.incident = {
      ...this.incident,
      assignmentGroupId: input.assignmentGroupId ?? null,
      assignmentGroup: input.assignmentGroup ?? null,
    };
    return {
      ...this.incident,
""",
)
replace_once(
    "tests/live-incident.test.ts",
    """  async assignIncident(input: { assignmentGroupId: string }) {
    this.incident = { ...this.incident, assignmentGroupId: input.assignmentGroupId };
    return this.readIncident();
  }
""",
    """  async assignIncident(input: { assignmentGroupId?: string; assignmentGroup?: string }) {
    this.incident = {
      ...this.incident,
      assignmentGroupId: input.assignmentGroupId ?? null,
      assignmentGroup: input.assignmentGroup ?? null,
    };
    return this.readIncident();
  }
""",
)
# Add a runtime regression before the final describe terminator.
live_test = read("tests/live-incident.test.ts")
legacy_test = r'''

  it('uses the reviewed legacy assignment label when the tenant has no group records', async () => {
    const legacyFixture: NilesIncidentFixtureV1 = {
      ...fixture,
      resources: {
        ...fixture.resources,
        assignmentGroup: { mode: 'LEGACY_LABEL', label: 'NVS Service Desk' },
      },
    };
    const adapter = new StatefulIncidentAdapter();
    const core = buildCore(adapter, liveEnvironment, {}, undefined, {}, legacyFixture);

    const run = await core.createLiveApiRun({
      runId: 'live-legacy-assignment-label',
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      confirmRealMutation: true,
      now: '2026-07-15T12:00:00.000Z',
    });

    expect(run.verdict).toBe('BLOCKED');
    expect(run.error?.code).toBe('NILES_CLOSE_AUTHORITY_UNSATISFIABLE');
    expect(run.resourceInventory.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ASSIGNMENT_LABEL',
          id: 'legacy-label:NVS Service Desk',
          label: 'NVS Service Desk',
        }),
      ]),
    );
    expect(adapter.incident.assignmentGroup).toBe('NVS Service Desk');
    expect(adapter.incident.assignmentGroupId).toBeNull();
    const progress = await core.getRunProgress(run.runId);
    expect(
      progress.observations.find((observation) => observation.sourceStepId === 'assign-service-desk')
        ?.evidence,
    ).toMatchObject({
      assignmentBindingMode: 'LEGACY_LABEL',
      assignmentGroup: 'NVS Service Desk',
      expectedAssignmentGroup: 'NVS Service Desk',
    });
  });
'''
if not live_test.rstrip().endswith("});"):
    raise RuntimeError("tests/live-incident.test.ts: final describe terminator not found")
live_test = live_test.rstrip()[:-3] + legacy_test + "\n});\n"
write("tests/live-incident.test.ts", live_test)

# Planner behavior regression: zero active groups now selects the explicit legacy label;
# ambiguity with multiple equally plausible groups still blocks.
plan_test_path = "tests/staging-fixture-plan-selection.test.ts"
plan_test = read(plan_test_path)
replace_once(
    plan_test_path,
    """  it('accepts the sole active group but blocks an ambiguous fallback', () => {
""",
    """  it('uses a legacy label for zero active groups, accepts the sole active group, and blocks ambiguity', () => {
""",
)
replace_once(
    plan_test_path,
    """selected, count, mode = module._choose_assignment_group(sole, "service desk")
assert selected["name"] == "Routing Team"
assert count == 2
assert mode == "SOLE_ACTIVE_FALLBACK"

ambiguous = [
""",
    """selected, count, mode = module._choose_assignment_group(sole, "service desk")
assert selected["name"] == "Routing Team"
assert count == 2
assert mode == "SOLE_ACTIVE_FALLBACK"

selected, count, mode = module._choose_assignment_group([], "service desk")
assert selected == {"mode": "LEGACY_LABEL", "label": "NVS Service Desk"}
assert count == 0
assert mode == "LEGACY_LABEL_FALLBACK"

ambiguous = [
""",
)

# Documentation records the actual staging capability fallback.
replace_once(
    "docs/operations/STAGING_BROWSER_OPERATOR.md",
    """A successful summary prints only the selector match counts and a SHA-256 proposal digest. Refine a selector and rerun `plan` whenever it matches zero or multiple eligible records.
""",
    """A successful summary prints only the selector match counts, assignment binding mode, and a SHA-256 proposal digest. Refine a selector and rerun `plan` whenever a canonical selector matches multiple eligible records. If the tenant has no active assignment-group records, planning uses the frozen NILES legacy `assignmentGroup` label contract with the deterministic label `NVS Service Desk`; it does not create shared NILES group data.
""",
)

# The diagnostic has served its purpose and must not remain on main.
one_shot = ROOT / ".github/workflows/one-shot-staging-fixture-plan.yml"
if one_shot.exists():
    one_shot.unlink()

print("legacy assignment-label patch applied")
