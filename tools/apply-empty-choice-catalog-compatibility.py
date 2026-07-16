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
        raise RuntimeError(f"{path}: expected one exact match, found {count}: {old[:140]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, *, flags: int = 0) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:180]!r}")
    write(path, next_text)


bootstrap = "ops/staging-fixture-bootstrap.mjs"
replace_once(
    bootstrap,
    """  ci: {
    name: 'NVS-PAYMENT-API-STG',
    description: 'Synthetic Payment API configuration item for NVS staging validation.',
    status: 'active',
    lifecycle: 'active',
    environment: 'staging',
    version: 'synthetic-v1',
  },
""",
    """  ci: {
    name: 'NVS-PAYMENT-API-STG',
    description: 'Synthetic Payment API configuration item for NVS staging validation.',
    lifecycle: 'active',
    environment: 'staging',
    category: 'application',
  },
""",
)

regex_once(
    bootstrap,
    r"(function requireUuid\(scope, value\) \{.*?\n\}\n)\nfunction classification",
    r"""\1
function resolveChoiceCompatibility(desiredChoice, records) {
  const activeRecords = records.filter((item) => asRecord(item)?.isActive !== false);
  const matches = exactMatches(activeRecords, 'value', desiredChoice.value);
  const choice = requireUnique(`${desiredChoice.table}.${desiredChoice.field} choice`, matches);
  if (choice) {
    return {
      desired: desiredChoice,
      existingId: requireUuid('choice', choice.id),
      compatibilityMode: 'CATALOG_RECORD',
    };
  }
  if (
    desiredChoice.table === 'itsm_incidents' &&
    desiredChoice.field === 'pendingReason' &&
    desiredChoice.value === 'pending_external_dependency'
  ) {
    return {
      desired: desiredChoice,
      compatibilityMode: 'BUILTIN_PRODUCT_DEFAULT',
    };
  }
  if (
    desiredChoice.table === 'itsm_incident_ci' &&
    ['relationshipType', 'impactScope'].includes(desiredChoice.field) &&
    records.length === 0
  ) {
    return {
      desired: desiredChoice,
      compatibilityMode: 'EMPTY_CATALOG_VALIDATION_BYPASS',
    };
  }
  throw new BootstrapError(
    'BOOTSTRAP_RESOURCE_INCOMPATIBLE',
    `The configured ${desiredChoice.table}.${desiredChoice.field} value is not accepted by the tenant choice contract.`,
  );
}

function classification""",
    flags=re.DOTALL,
)

replace_once(
    bootstrap,
    """      `/grc/itsm/choices?table=${encoded(desiredChoice.table)}&field=${encoded(desiredChoice.field)}`,
""",
    """      `/grc/itsm/choices?table=${encoded(desiredChoice.table)}&field=${encoded(desiredChoice.field)}&includeInactive=true`,
""",
)
regex_once(
    bootstrap,
    r"    const matches = exactMatches\(arrayFrom\(payload\), 'value', desiredChoice\.value\);\n"
    r"    const choice = requireUnique\(`\$\{desiredChoice\.table\}\.\$\{desiredChoice\.field\} choice`, matches\);\n"
    r"    if \(choice\?\.isActive === false\) \{.*?\n"
    r"    choiceState\.push\(\{\n"
    r"      desired: desiredChoice,\n"
    r"      existingId: choice \? requireUuid\('choice', choice\.id\) : undefined,\n"
    r"    \}\);",
    """    const records = arrayFrom(payload);
    choiceState.push(resolveChoiceCompatibility(desiredChoice, records));""",
    flags=re.DOTALL,
)

regex_once(
    bootstrap,
    r"  let policyState = \{ kind: 'MISSING' \};.*?\n  \}\n\n  if \(offering && policyState\.kind === 'PUBLISHED'\)",
    """  let policyState = { kind: 'MISSING' };
  if (policy) {
    const policyId = requireUuid('governed SLA policy', policy.id);
    const publishedSummary = asRecord(policy.publishedRevisionSummary);
    const draftSummary = asRecord(policy.activeDraftSummary);
    const readRevision = async (revisionId, scope) =>
      asRecord(
        await api(
          context,
          admin,
          'GET',
          `/grc/itsm/sla/governed/revisions/${revisionId}`,
          undefined,
          undefined,
          scope,
        ),
      );
    if (publishedSummary) {
      const revisionId = requireUuid('published SLA revision', publishedSummary.revisionId);
      const revision = await readRevision(revisionId, 'read published governed SLA revision');
      if (!serviceId || !compatibleSnapshot(revision?.snapshot, policySnapshot(serviceId))) {
        throw new BootstrapError(
          'BOOTSTRAP_RESOURCE_INCOMPATIBLE',
          'The deterministic governed SLA policy has an incompatible published snapshot.',
        );
      }
      policyState = {
        kind: 'PUBLISHED',
        policyId,
        revisionId,
        runtimeDefinitionId: requireUuid(
          'published SLA runtime definition',
          policy.runtimeDefinitionId,
        ),
      };
    } else if (draftSummary) {
      const revisionId = requireUuid('draft SLA revision', draftSummary.revisionId);
      const revision = await readRevision(revisionId, 'read draft governed SLA revision');
      if (!serviceId || !compatibleSnapshot(revision?.snapshot, policySnapshot(serviceId))) {
        throw new BootstrapError(
          'BOOTSTRAP_RESOURCE_INCOMPATIBLE',
          'The deterministic governed SLA policy has an incompatible draft snapshot.',
        );
      }
      policyState = {
        kind: 'DRAFT',
        policyId,
        revisionId,
      };
    } else {
      throw new BootstrapError(
        'BOOTSTRAP_RESOURCE_INCOMPATIBLE',
        'The deterministic governed SLA policy has no usable revision.',
      );
    }
  }

  if (offering && policyState.kind === 'PUBLISHED')""",
    flags=re.DOTALL,
)

replace_once(
    bootstrap,
    """  for (const choice of choiceState) {
    if (!choice.existingId) actions.push(`CREATE_CHOICE_${choice.desired.field.toUpperCase()}`);
  }
""",
    "",
)
replace_once(
    bootstrap,
    """      choices: choiceState.map((choice) => ({
        table: choice.desired.table,
        field: choice.desired.field,
        value: choice.desired.value,
        existingId: choice.existingId ?? null,
      })),
""",
    """      choices: choiceState.map((choice) => ({
        table: choice.desired.table,
        field: choice.desired.field,
        value: choice.desired.value,
        existingId: choice.existingId ?? null,
        compatibilityMode: choice.compatibilityMode,
      })),
""",
)
replace_once(
    bootstrap,
    """    const runtimeDefinitionId = safeString(
      asRecord(match?.publishedRevisionSummary)?.runtimeDefinitionId,
    );
""",
    """    const runtimeDefinitionId = safeString(match?.runtimeDefinitionId);
""",
)
regex_once(
    bootstrap,
    r"  for \(const choice of plan\.state\.choiceState\) \{.*?\n  \}\n\n  const policy =",
    """  for (const choice of plan.state.choiceState) {
    effects.push({
      resource: `choice:${choice.desired.field}`,
      disposition: choice.existingId ? 'REUSED' : 'PRODUCT_DEFAULT',
      compatibilityMode: choice.compatibilityMode,
    });
  }

  const policy =""",
    flags=re.DOTALL,
)
replace_once(
    bootstrap,
    """      { ...DESIRED.ci, classId, ownerUserId: serviceDesk.userId },
""",
    """      { ...DESIRED.ci, classId, ownedBy: serviceDesk.userId },
""",
)
replace_once(
    bootstrap,
    """      choices: plan.state.choiceState.map((choice) => ({
        table: choice.desired.table,
        field: choice.desired.field,
        value: choice.desired.value,
      })),
""",
    """      choices: plan.state.choiceState.map((choice) => ({
        table: choice.desired.table,
        field: choice.desired.field,
        value: choice.desired.value,
        compatibilityMode: choice.compatibilityMode,
      })),
""",
)

core = "packages/core/src/index.ts"
replace_once(
    core,
    """  }): Promise<{ values: string[]; transport?: NilesTransportEvidence }>;
""",
    """  }): Promise<{
    values: string[];
    configuredCount: number;
    transport?: NilesTransportEvidence;
  }>;
""",
)
replace_once(
    core,
    """      if (result.transport) transports.push(result.transport);
      if (!result.values.includes(requirement.expected)) {
        throw new LiveRunBlockedError(
          'NILES_FIXTURE_CHOICE_UNSUPPORTED',
          `Configured ${requirement.table}.${requirement.field} value is not available in the tenant choice catalog.`,
          'ENVIRONMENT',
        );
      }
""",
    """      if (result.transport) transports.push(result.transport);
      const normalizedExpected = requirement.expected.trim().toLowerCase();
      const activeValues = new Set(result.values.map((value) => value.trim().toLowerCase()));
      const builtinPendingReason =
        requirement.table === 'itsm_incidents' &&
        requirement.field === 'pendingReason' &&
        normalizedExpected === 'pending_external_dependency';
      const emptyIncidentCiCatalog =
        requirement.table === 'itsm_incident_ci' &&
        ['relationshipType', 'impactScope'].includes(requirement.field) &&
        result.configuredCount === 0;
      if (
        !activeValues.has(normalizedExpected) &&
        !builtinPendingReason &&
        !emptyIncidentCiCatalog
      ) {
        throw new LiveRunBlockedError(
          'NILES_FIXTURE_CHOICE_UNSUPPORTED',
          `Configured ${requirement.table}.${requirement.field} value is not accepted by the tenant choice contract.`,
          'ENVIRONMENT',
        );
      }
""",
)

adapter = "packages/adapter-niles/src/index.ts"
regex_once(
    adapter,
    r"  readChoiceValues\(input: \{.*?\n  \}\n\n  createIncident\(input:",
    """  readChoiceValues(input: {
    environment: EnvironmentDefinitionV1;
    session: ActorSession;
    tenantId: string;
    table: 'itsm_incidents' | 'itsm_incident_ci';
    field: 'pendingReason' | 'relationshipType' | 'impactScope';
    correlationId: string;
  }): Promise<{
    values: string[];
    configuredCount: number;
    transport?: NilesTransportEvidence;
  }> {
    const query = new URLSearchParams({
      table: input.table,
      field: input.field,
      includeInactive: 'true',
    });
    return this.request({
      ...input,
      method: 'GET',
      path: `/grc/itsm/choices?${query.toString()}`,
      pathTemplate: '/grc/itsm/choices?table=:table&field=:field&includeInactive=true',
      operation: `read ${input.table}.${input.field} choices`,
    }).then((response) => {
      const entries = asArrayPayload(response.payload);
      return {
        values: entries.flatMap((entry) => {
          const record = asRecord(entry);
          const value = safeString(record?.['value']);
          return value && record?.['isActive'] !== false ? [value] : [];
        }),
        configuredCount: entries.length,
        transport: response.transport,
      };
    });
  }

  createIncident(input:""",
    flags=re.DOTALL,
)

discovery = "ops/staging-fixture-discovery.mjs"
replace_once(
    discovery,
    """function selectChoice(value) {
  const item = asRecord(value);
  return safeString(item?.value);
}
""",
    """function selectChoice(value) {
  const item = asRecord(value);
  const choiceValue = safeString(item?.value);
  if (!choiceValue) return undefined;
  return {
    value: choiceValue,
    isActive: safeBoolean(item?.isActive) ?? true,
  };
}
""",
)
replace_once(
    discovery,
    """      `/grc/itsm/choices?table=${encodeURIComponent(table)}&field=${encodeURIComponent(field)}`,
""",
    """      `/grc/itsm/choices?table=${encodeURIComponent(table)}&field=${encodeURIComponent(field)}&includeInactive=true`,
""",
)
replace_once(
    discovery,
    """    choices: {
      pendingReason: [...pendingReason].sort(),
      relationshipType: [...relationshipType].sort(),
      impactScope: [...impactScope].sort(),
    },
    errors,
""",
    """    choices: {
      pendingReason: pendingReason
        .filter((choice) => choice.isActive !== false)
        .map((choice) => choice.value)
        .sort(),
      relationshipType: relationshipType
        .filter((choice) => choice.isActive !== false)
        .map((choice) => choice.value)
        .sort(),
      impactScope: impactScope
        .filter((choice) => choice.isActive !== false)
        .map((choice) => choice.value)
        .sort(),
    },
    choiceCatalogCounts: {
      pendingReason: pendingReason.length,
      relationshipType: relationshipType.length,
      impactScope: impactScope.length,
    },
    errors,
""",
)

planner = "ops/staging-fixture-plan.py"
replace_once(
    planner,
    """def _assignment_selection(item: dict[str, Any], mode: str) -> dict[str, Any]:
    if mode == "LEGACY_LABEL_FALLBACK":
        label = item.get("label")
        if not isinstance(label, str) or not label.strip() or len(label) > 100:
            raise PlanError("legacy assignment label is invalid.")
        return {"mode": "LEGACY_LABEL", "label": label}
    return {"mode": "CANONICAL_ID", **_selection(item)}


""",
    """def _assignment_selection(item: dict[str, Any], mode: str) -> dict[str, Any]:
    if mode == "LEGACY_LABEL_FALLBACK":
        label = item.get("label")
        if not isinstance(label, str) or not label.strip() or len(label) > 100:
            raise PlanError("legacy assignment label is invalid.")
        return {"mode": "LEGACY_LABEL", "label": label}
    return {"mode": "CANONICAL_ID", **_selection(item)}


def _choice_compatibility(
    field: str,
    values: Any,
    configured_count: Any,
    expected: str,
) -> str:
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise PlanError(f"tenant choice catalog for {field} returned an invalid shape.")
    if not isinstance(configured_count, int) or configured_count < 0:
        raise PlanError(f"tenant choice catalog count for {field} is unavailable.")
    normalized = {value.casefold() for value in values}
    if expected.casefold() in normalized:
        return "CATALOG_RECORD"
    if field == "pendingReason" and expected == "pending_external_dependency":
        return "BUILTIN_PRODUCT_DEFAULT"
    if field in {"relationshipType", "impactScope"} and configured_count == 0:
        return "EMPTY_CATALOG_VALIDATION_BYPASS"
    raise PlanError(
        f"tenant choice contract does not accept required {field} value {expected}."
    )


""",
)
replace_once(
    planner,
    """    for field, expected in required_choices.items():
        values = choice_map.get(field)
        if not isinstance(values, list) or expected not in values:
            raise PlanError(
                f"tenant choice catalog does not contain required {field} value {expected}."
            )

    generated_at = datetime.now(timezone.utc).isoformat()
""",
    """    catalog_counts = discovery.get("choiceCatalogCounts")
    count_map = catalog_counts if isinstance(catalog_counts, dict) else {}
    choice_compatibility = {
        field: _choice_compatibility(
            field,
            choice_map.get(field),
            count_map.get(field),
            expected,
        )
        for field, expected in required_choices.items()
    }

    generated_at = datetime.now(timezone.utc).isoformat()
""",
)
replace_once(
    planner,
    '        "choices": required_choices,\n',
    '        "choices": required_choices,\n        "choiceCompatibility": choice_compatibility,\n',
)
replace_once(
    planner,
    """    print(f"- CI eligible matches: `1` of `{ci_count}` returned")
    print(f"- Server proposal file: `{proposal_path}`")
""",
    """    print(f"- CI eligible matches: `1` of `{ci_count}` returned")
    print(
        "- Choice compatibility: `"
        + ", ".join(
            f"{field}={mode}" for field, mode in sorted(choice_compatibility.items())
        )
        + "`"
    )
    print(f"- Server proposal file: `{proposal_path}`")
""",
)

live_test = "tests/live-incident.test.ts"
replace_once(
    live_test,
    """  async readChoiceValues(input: { field: 'pendingReason' | 'relationshipType' | 'impactScope' }) {
    this.operations.push(`GET choices ${input.field}`);
    const values =
      input.field === 'pendingReason'
        ? ['pending_external_dependency']
        : input.field === 'relationshipType'
          ? ['affected_by']
          : ['service_impacting'];
    return {
      values,
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/choices?table=:table&field=:field',
        httpStatus: 200,
        durationMs: 1,
        correlationId: `choice_${input.field}`,
      },
    };
  }
""",
    """  async readChoiceValues(input: { field: 'pendingReason' | 'relationshipType' | 'impactScope' }) {
    this.operations.push(`GET choices ${input.field}`);
    return {
      values: [],
      configuredCount: 0,
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/choices?table=:table&field=:field&includeInactive=true',
        httpStatus: 200,
        durationMs: 1,
        correlationId: `choice_${input.field}`,
      },
    };
  }
""",
)
replace_once(
    live_test,
    """  it('blocks a live run before mutation when a required fixture resource is missing', async () => {
""",
    """  it('blocks a non-empty incident-CI choice catalog that omits the required value', async () => {
    class IncompatibleChoiceAdapter extends StatefulIncidentAdapter {
      override async readChoiceValues(input: {
        field: 'pendingReason' | 'relationshipType' | 'impactScope';
      }) {
        const result = await super.readChoiceValues(input);
        return input.field === 'relationshipType'
          ? { ...result, values: ['caused_by'], configuredCount: 1 }
          : result;
      }
    }
    const adapter = new IncompatibleChoiceAdapter();
    const core = buildCore(adapter);

    const readiness = await core.confirmExecutionReadiness({
      environmentId: 'live-test',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
    });

    expect(readiness).toMatchObject({
      verdict: 'BLOCKED',
      confirmed: true,
      mutationEligible: false,
      error: { code: 'NILES_FIXTURE_CHOICE_UNSUPPORTED' },
    });
    expect(adapter.operations.some((operation) => operation.startsWith('POST'))).toBe(false);
  });

  it('blocks a live run before mutation when a required fixture resource is missing', async () => {
""",
)

planner_test = "tests/staging-fixture-plan-selection.test.ts"
replace_once(
    planner_test,
    """  it('uses a legacy label for zero active groups, accepts the sole active group, and blocks ambiguity', () => {
""",
    """  it('accepts product-default choice contracts and blocks configured incompatible values', () => {
    const python = runPython(String.raw`
import importlib.util
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("fixture_plan", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module._choice_compatibility(
    "pendingReason", ["pending_customer"], 1, "pending_external_dependency"
) == "BUILTIN_PRODUCT_DEFAULT"
assert module._choice_compatibility(
    "relationshipType", [], 0, "affected_by"
) == "EMPTY_CATALOG_VALIDATION_BYPASS"
assert module._choice_compatibility(
    "impactScope", ["service_impacting"], 1, "service_impacting"
) == "CATALOG_RECORD"

try:
    module._choice_compatibility("relationshipType", ["caused_by"], 1, "affected_by")
except module.PlanError as error:
    assert "does not accept" in str(error)
else:
    raise AssertionError("a configured incompatible incident-CI catalog must remain blocked")
`);

    expect(python.status, python.stderr).toBe(0);
  });

  it('uses a legacy label for zero active groups, accepts the sole active group, and blocks ambiguity', () => {
""",
)

bootstrap_test = "tests/staging-fixture-bootstrap-assets.test.ts"
replace_once(
    bootstrap_test,
    """    expect(source).toContain("operator: 'is', value: serviceId");
    expect(source.match(/'x-correlation-id': randomUUID\(\)/g)).toHaveLength(2);
    expect(source).not.toContain('bootstrap_${randomUUID');
""",
    """    expect(source).toContain("operator: 'is', value: serviceId");
    expect(source).toContain('BUILTIN_PRODUCT_DEFAULT');
    expect(source).toContain('EMPTY_CATALOG_VALIDATION_BYPASS');
    expect(source).toContain("disposition: choice.existingId ? 'REUSED' : 'PRODUCT_DEFAULT'");
    expect(source).toContain('includeInactive=true');
    expect(source).toContain('safeString(match?.runtimeDefinitionId)');
    expect(source).toContain('ownedBy: serviceDesk.userId');
    expect(source).not.toContain("'/grc/itsm/choices',");
    expect(source).not.toContain('CREATE_CHOICE_');
    expect(source.match(/'x-correlation-id': randomUUID\(\)/g)).toHaveLength(2);
    expect(source).not.toContain('bootstrap_${randomUUID');
""",
)

adapter_test = "tests/niles-incident-adapter.test.ts"
replace_once(
    adapter_test,
    """  it('parses affected-CI paginated object envelopes', async () => {
""",
    """  it('reads active choice values while retaining the configured catalog count', async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            { value: 'affected_by', isActive: true },
            { value: 'caused_by', isActive: false },
          ],
        }),
        { status: 200 },
      ),
    );
    const adapter = new NilesIncidentApiAdapter(fetchMock, 100);

    await expect(
      adapter.readChoiceValues({
        environment,
        session,
        tenantId,
        table: 'itsm_incident_ci',
        field: 'relationshipType',
        correlationId: 'read-choice-catalog',
      }),
    ).resolves.toMatchObject({ values: ['affected_by'], configuredCount: 2 });

    const [requestUrl] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toContain('includeInactive=true');
  });

  it('parses affected-CI paginated object envelopes', async () => {
""",
)

operator_test = "tests/staging-operator-assets.test.ts"
replace_once(
    operator_test,
    """    expect(discovery).toContain('queries,');
""",
    """    expect(discovery).toContain('queries,');
    expect(discovery).toContain('includeInactive=true');
    expect(discovery).toContain('choiceCatalogCounts');
""",
)

docs = "docs/operations/STAGING_FIXTURE_BOOTSTRAP.md"
replace_once(
    docs,
    """- canonical Incident and Incident-CI choice values required by the fixture contract
""",
    """- read-only compatibility checks for the Incident and Incident-CI choice contract
""",
)
replace_once(
    docs,
    """The Service Desk synthetic actor is added to the dedicated assignment group. The governed SLA policy is requested by the tenant-admin actor, approved by the incident-manager actor, and published by the tenant-admin actor. Its condition is limited to the deterministic Payment API service.
""",
    """The Service Desk synthetic actor is added to the dedicated assignment group. The governed SLA policy is requested by the tenant-admin actor, approved by the incident-manager actor, and published by the tenant-admin actor. Its condition is limited to the deterministic Payment API service.

The bootstrap does not create ITSM choice rows. It accepts the built-in `pending_external_dependency` reason, accepts `affected_by` and `service_impacting` only when the corresponding Incident-CI catalogs are truly unconfigured, reuses matching active catalog records when present, and blocks non-empty incompatible catalogs.
""",
)
replace_once(
    docs,
    """Creation uses deterministic exact-name lookups and idempotency keys. Existing compatible records are reused. Duplicate or incompatible exact records block the operation. There is no broad search-and-delete behavior and no automatic rollback that might remove shared records. A partially completed apply is resumed by running a new plan and applying its new digest.
""",
    """Creation uses deterministic exact-name lookups and idempotency keys. Existing compatible records are reused. Duplicate or incompatible exact records block the operation. Choice compatibility is read-only and follows the pinned NILES product-default contract; retired legacy choice-write endpoints are never called. There is no broad search-and-delete behavior and no automatic rollback that might remove shared records. A partially completed apply is resumed by running a new plan and applying its new digest.
""",
)
