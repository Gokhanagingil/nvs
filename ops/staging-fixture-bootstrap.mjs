import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CONFIG_DIR = process.env.NVS_CONFIG_DIR || '/app/config';
const OPERATION = (process.env.NVS_BOOTSTRAP_OPERATION || 'plan').trim();
const EXPECTED_DIGEST = (process.env.NVS_BOOTSTRAP_EXPECTED_DIGEST || '').trim();
const CONFIRMATION = (process.env.NVS_BOOTSTRAP_CONFIRMATION || '').trim();
const ENVIRONMENT_ID = (process.env.NVS_BOOTSTRAP_ENVIRONMENT_ID || 'staging-example').trim();
const REQUEST_TIMEOUT_MS = 10_000;
const APPLY_CONFIRMATION = 'BOOTSTRAP_M1_02B_FIXTURES';
const INVENTORY_PATH = '/app/data/bootstrap/staging-fixture-bootstrap.json';

const DESIRED = Object.freeze({
  group: {
    name: 'NVS Service Desk',
    description: 'Dedicated synthetic NVS staging assignment group.',
  },
  ciClass: {
    name: 'nvs_application',
    label: 'NVS Application',
    description: 'Dedicated CI class for synthetic NVS staging fixtures.',
  },
  service: {
    name: 'NVS Payment API',
    description: 'Synthetic payment API service used only by NVS staging validation.',
    type: 'application_service',
    status: 'active',
    tier: 'tier_1',
    criticality: 'high',
  },
  offering: {
    name: 'NVS Payment API Standard',
    status: 'active',
    supportHours: '24x7',
  },
  ci: {
    name: 'NVS-PAYMENT-API-STG',
    description: 'Synthetic Payment API configuration item for NVS staging validation.',
    status: 'active',
    lifecycle: 'active',
    environment: 'staging',
    version: 'synthetic-v1',
  },
  choices: [
    {
      table: 'itsm_incidents',
      field: 'pendingReason',
      value: 'pending_external_dependency',
      label: 'Pending External Dependency',
      order: 900,
    },
    {
      table: 'itsm_incident_ci',
      field: 'relationshipType',
      value: 'affected_by',
      label: 'Affected By',
      order: 900,
    },
    {
      table: 'itsm_incident_ci',
      field: 'impactScope',
      value: 'service_impacting',
      label: 'Service Impacting',
      order: 900,
    },
  ],
  sla: {
    name: 'NVS Payment API Incident SLA',
    description: 'Dedicated governed Incident SLA for synthetic NVS Payment API validation.',
  },
});

class BootstrapError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function unwrapData(value) {
  const root = asRecord(value);
  return root && Object.prototype.hasOwnProperty.call(root, 'data') ? root.data : value;
}

function arrayFrom(value, key = 'items') {
  const payload = unwrapData(value);
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  return Array.isArray(record?.[key]) ? record[key] : [];
}

function safeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function scalar(raw) {
  const value = raw.trim();
  if (!value) return '';
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  return value;
}

function parseTopLevelYaml(text) {
  const result = {};
  for (const line of text.split(/\r?\n/u)) {
    if (!line || /^\s/u.test(line) || /^\s*#/u.test(line)) continue;
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u.exec(line);
    if (!match) continue;
    result[match[1]] = scalar(match[2] || '');
  }
  return result;
}

async function readYamlDirectory(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/iu.test(entry.name)) continue;
    result.push(parseTopLevelYaml(await readFile(path.join(directory, entry.name), 'utf8')));
  }
  return result;
}

function credentialEnvironmentName(reference) {
  if (!/^[A-Za-z0-9._-]+$/u.test(reference)) {
    throw new BootstrapError('CREDENTIAL_REFERENCE_INVALID', 'An actor credential reference is invalid.');
  }
  return `NVS_CREDENTIAL_${[...reference]
    .map((character) =>
      character === '.' ? '_DOT_' : character === '-' ? '_DASH_' : character.toUpperCase(),
    )
    .join('')}`;
}

function resolveCredential(reference) {
  const raw = process.env[credentialEnvironmentName(reference)];
  if (!raw) {
    throw new BootstrapError('CREDENTIAL_MISSING', 'A required staging actor credential is missing.');
  }
  let value = raw.trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BootstrapError('CREDENTIAL_INVALID', 'A required staging actor credential is invalid.');
  }
  const record = asRecord(parsed);
  const email = safeString(record?.email);
  const password = typeof record?.password === 'string' ? record.password : '';
  if (!email || !password) {
    throw new BootstrapError('CREDENTIAL_INVALID', 'A required staging actor credential is incomplete.');
  }
  return { email, password };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function exactMatches(values, field, expected) {
  return values.filter((item) => safeString(asRecord(item)?.[field]) === expected);
}

function requireUnique(scope, matches) {
  if (matches.length > 1) {
    throw new BootstrapError(
      'BOOTSTRAP_DUPLICATE_RESOURCE',
      `${scope} has multiple exact deterministic matches and requires operator reconciliation.`,
    );
  }
  return matches[0] ? asRecord(matches[0]) : undefined;
}

function requireUuid(scope, value) {
  const candidate = safeString(value);
  if (!candidate || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)) {
    throw new BootstrapError('BOOTSTRAP_RESPONSE_INVALID', `${scope} did not expose a valid UUID.`);
  }
  return candidate;
}

function classification(status) {
  if (status === 400) return ['NILES_PRODUCT_RULE_REJECTED', false];
  if (status === 401 || status === 403) return ['NILES_AUTHORIZATION_DENIED', false];
  if (status === 404) return ['NILES_RESOURCE_MISSING', false];
  if (status === 409) return ['NILES_CONFLICT', false];
  if (status === 429) return ['NILES_RATE_LIMITED', true];
  if (status >= 500) return ['NILES_UPSTREAM_FAILURE', true];
  return ['NILES_HTTP_FAILURE', false];
}

async function fetchJson(url, init, scope) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new BootstrapError(
      timedOut ? 'NILES_REQUEST_TIMEOUT' : 'NILES_NETWORK_FAILURE',
      timedOut ? `${scope} exceeded its deadline.` : `${scope} could not reach NILES.`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const [code] = classification(response.status);
    throw new BootstrapError(code, `${scope} returned HTTP ${response.status}.`, response.status);
  }
  if (payload === undefined) {
    throw new BootstrapError('NILES_MALFORMED_RESPONSE', `${scope} returned invalid JSON.`);
  }
  return unwrapData(payload);
}

async function login(baseUrl, profile, expectedTenantId) {
  const credential = resolveCredential(profile.credentialRef);
  try {
    const payload = await fetchJson(
      new URL('/auth/login', baseUrl),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-correlation-id': `bootstrap_login_${randomUUID().replaceAll('-', '')}`,
        },
        body: JSON.stringify({ email: credential.email, password: credential.password }),
      },
      `${profile.persona} login`,
    );
    const record = asRecord(payload);
    const user = asRecord(record?.user);
    const accessToken = safeString(record?.accessToken);
    const userId = requireUuid(`${profile.persona} login user`, user?.id);
    const tenantId = requireUuid(`${profile.persona} login tenant`, user?.tenantId);
    if (!accessToken || tenantId !== expectedTenantId) {
      throw new BootstrapError('TENANT_MISMATCH', 'A staging actor authenticated into an unexpected tenant.');
    }
    return { accessToken, userId, tenantId, persona: profile.persona };
  } finally {
    credential.email = '';
    credential.password = '';
  }
}

function headers(session, tenantId, idempotencyKey) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${session.accessToken}`,
    'x-tenant-id': tenantId,
    'x-correlation-id': `bootstrap_${randomUUID().replaceAll('-', '')}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

async function api(context, session, method, pathname, body, idempotencyKey, scope) {
  return fetchJson(
    new URL(pathname, context.baseUrl),
    {
      method,
      headers: {
        ...headers(session, context.tenantId, idempotencyKey),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    scope,
  );
}

function policySnapshot(serviceId) {
  return {
    name: DESIRED.sla.name,
    description: DESIRED.sla.description,
    appliesToRecordType: 'INCIDENT',
    commitmentLayer: 'SLA',
    conditionTree: {
      operator: 'AND',
      children: [{ field: 'serviceId', operator: 'is', value: serviceId }],
    },
    responseTimeSeconds: 900,
    resolutionTimeSeconds: 3600,
    fulfillmentTimeSeconds: null,
    schedule: '24X7',
    businessStartHour: 9,
    businessEndHour: 17,
    businessDays: [1, 2, 3, 4, 5],
    pauseOnStates: ['on_hold'],
    stopOnStates: ['resolved', 'closed'],
    warningThresholdPct: 80,
    priorityWeight: 1000,
    stopProcessing: true,
    order: 10,
  };
}

function compatibleSnapshot(observed, expected) {
  const record = asRecord(observed);
  if (!record) return false;
  const keys = [
    'name',
    'appliesToRecordType',
    'commitmentLayer',
    'conditionTree',
    'responseTimeSeconds',
    'resolutionTimeSeconds',
    'fulfillmentTimeSeconds',
    'schedule',
    'businessStartHour',
    'businessEndHour',
    'businessDays',
    'pauseOnStates',
    'stopOnStates',
    'warningThresholdPct',
    'priorityWeight',
    'stopProcessing',
    'order',
  ];
  return keys.every(
    (key) => JSON.stringify(canonicalize(record[key])) === JSON.stringify(canonicalize(expected[key])),
  );
}

async function discover(context) {
  const { admin, manager, serviceDesk } = context.sessions;
  const encoded = encodeURIComponent;
  const [groupsPayload, classesPayload, servicesPayload, offeringsPayload, cisPayload, policiesPayload, writesPayload] =
    await Promise.all([
      api(
        context,
        admin,
        'GET',
        `/grc/groups/directory?page=1&pageSize=100&search=${encoded(DESIRED.group.name)}`,
        undefined,
        undefined,
        'list assignment groups',
      ),
      api(
        context,
        admin,
        'GET',
        `/grc/cmdb/classes?page=1&pageSize=100&search=${encoded(DESIRED.ciClass.name)}`,
        undefined,
        undefined,
        'list CI classes',
      ),
      api(
        context,
        admin,
        'GET',
        `/grc/cmdb/services?page=1&pageSize=100&search=${encoded(DESIRED.service.name)}`,
        undefined,
        undefined,
        'list CMDB services',
      ),
      api(
        context,
        admin,
        'GET',
        `/grc/cmdb/service-offerings?page=1&pageSize=100&search=${encoded(DESIRED.offering.name)}`,
        undefined,
        undefined,
        'list service offerings',
      ),
      api(
        context,
        admin,
        'GET',
        `/grc/cmdb/cis/search?limit=100&q=${encoded(DESIRED.ci.name)}`,
        undefined,
        undefined,
        'list configuration items',
      ),
      api(
        context,
        admin,
        'GET',
        '/grc/itsm/sla/governed/policies',
        undefined,
        undefined,
        'list governed SLA policies',
      ),
      api(
        context,
        admin,
        'GET',
        '/grc/itsm/sla/governed/writes-enabled',
        undefined,
        undefined,
        'read governed SLA write state',
      ),
    ]);

  const group = requireUnique('assignment group', exactMatches(arrayFrom(groupsPayload), 'name', DESIRED.group.name));
  const ciClass = requireUnique('CI class', exactMatches(arrayFrom(classesPayload), 'name', DESIRED.ciClass.name));
  const service = requireUnique('CMDB service', exactMatches(arrayFrom(servicesPayload), 'name', DESIRED.service.name));
  const offering = requireUnique('service offering', exactMatches(arrayFrom(offeringsPayload), 'name', DESIRED.offering.name));
  const ci = requireUnique('configuration item', exactMatches(arrayFrom(cisPayload), 'name', DESIRED.ci.name));
  const policy = requireUnique(
    'governed SLA policy',
    exactMatches(arrayFrom(policiesPayload, 'policies'), 'policyName', DESIRED.sla.name),
  );

  if (group?.isActive === false) {
    throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic assignment group exists but is inactive.');
  }
  if (ciClass && safeString(ciClass.label) !== DESIRED.ciClass.label) {
    throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic CI class has incompatible metadata.');
  }
  if (service) {
    for (const [field, expected] of [
      ['type', DESIRED.service.type],
      ['status', DESIRED.service.status],
      ['tier', DESIRED.service.tier],
      ['criticality', DESIRED.service.criticality],
    ]) {
      if (safeString(service[field]) !== expected) {
        throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic CMDB service has incompatible metadata.');
      }
    }
  }

  const groupId = group ? requireUuid('assignment group', group.id) : undefined;
  const classId = ciClass ? requireUuid('CI class', ciClass.id) : undefined;
  const serviceId = service ? requireUuid('CMDB service', service.id) : undefined;
  const offeringId = offering ? requireUuid('service offering', offering.id) : undefined;
  const ciId = ci ? requireUuid('configuration item', ci.id) : undefined;

  if (offering && (!serviceId || safeString(offering.serviceId) !== serviceId)) {
    throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic offering is not linked to the deterministic service.');
  }
  if (ci && (!classId || safeString(ci.classId) !== classId)) {
    throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic CI is not linked to the deterministic CI class.');
  }

  let groupMemberPresent = false;
  if (groupId) {
    const membersPayload = await api(
      context,
      admin,
      'GET',
      `/grc/groups/${groupId}/members`,
      undefined,
      undefined,
      'list group members',
    );
    groupMemberPresent = arrayFrom(membersPayload).some(
      (entry) => safeString(asRecord(entry)?.userId) === serviceDesk.userId,
    );
  }

  const choiceState = [];
  for (const desiredChoice of DESIRED.choices) {
    const payload = await api(
      context,
      admin,
      'GET',
      `/grc/itsm/choices?table=${encoded(desiredChoice.table)}&field=${encoded(desiredChoice.field)}`,
      undefined,
      undefined,
      `list ${desiredChoice.field} choices`,
    );
    const matches = exactMatches(arrayFrom(payload), 'value', desiredChoice.value);
    const choice = requireUnique(`${desiredChoice.table}.${desiredChoice.field} choice`, matches);
    if (choice?.isActive === false) {
      throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'A deterministic choice exists but is inactive.');
    }
    choiceState.push({ desired: desiredChoice, existingId: choice ? requireUuid('choice', choice.id) : undefined });
  }

  const writes = asRecord(writesPayload);
  if (writes?.writesEnabled !== true) {
    throw new BootstrapError('GOVERNED_SLA_WRITES_DISABLED', 'Governed SLA policy writes are disabled in staging.');
  }

  let policyState = { kind: 'MISSING' };
  if (policy) {
    const policyId = requireUuid('governed SLA policy', policy.policyId);
    const details = asRecord(
      await api(
        context,
        admin,
        'GET',
        `/grc/itsm/sla/governed/policies/${policyId}`,
        undefined,
        undefined,
        'read governed SLA policy details',
      ),
    );
    const published = asRecord(details?.publishedRevision);
    const draft = asRecord(details?.activeDraft);
    if (published) {
      if (!serviceId || !compatibleSnapshot(published.snapshot, policySnapshot(serviceId))) {
        throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic governed SLA policy has an incompatible published snapshot.');
      }
      policyState = {
        kind: 'PUBLISHED',
        policyId,
        revisionId: requireUuid('published SLA revision', published.id),
        runtimeDefinitionId: requireUuid('published SLA runtime definition', published.runtimeDefinitionId),
      };
    } else if (draft) {
      if (!serviceId || !compatibleSnapshot(draft.snapshot, policySnapshot(serviceId))) {
        throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic governed SLA policy has an incompatible draft snapshot.');
      }
      policyState = {
        kind: 'DRAFT',
        policyId,
        revisionId: requireUuid('draft SLA revision', draft.id),
      };
    } else {
      throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic governed SLA policy has no usable revision.');
    }
  }

  if (offering && policyState.kind === 'PUBLISHED') {
    const configuredProfile = safeString(offering.defaultSlaProfileId);
    if (configuredProfile && configuredProfile !== policyState.runtimeDefinitionId) {
      throw new BootstrapError('BOOTSTRAP_RESOURCE_INCOMPATIBLE', 'The deterministic offering references a different SLA profile.');
    }
  }

  const actions = [];
  if (!groupId) actions.push('CREATE_ASSIGNMENT_GROUP');
  if (!groupMemberPresent) actions.push('ADD_SERVICE_DESK_MEMBER');
  if (!classId) actions.push('CREATE_CI_CLASS');
  if (!serviceId) actions.push('CREATE_CMDB_SERVICE');
  for (const choice of choiceState) {
    if (!choice.existingId) actions.push(`CREATE_CHOICE_${choice.desired.field.toUpperCase()}`);
  }
  if (policyState.kind === 'MISSING') actions.push('CREATE_AND_PUBLISH_GOVERNED_SLA');
  if (policyState.kind === 'DRAFT') actions.push('COMPLETE_GOVERNED_SLA_PUBLISH');
  if (!offeringId) actions.push('CREATE_SERVICE_OFFERING');
  if (!ciId) actions.push('CREATE_CONFIGURATION_ITEM');

  const internalPlan = {
    schemaVersion: 'nvs.staging-fixture-bootstrap-plan/v1',
    environmentId: ENVIRONMENT_ID,
    tenantId: context.tenantId,
    serviceDeskUserId: serviceDesk.userId,
    desiredVersion: 1,
    existing: {
      groupId: groupId ?? null,
      groupMemberPresent,
      classId: classId ?? null,
      serviceId: serviceId ?? null,
      offeringId: offeringId ?? null,
      ciId: ciId ?? null,
      choices: choiceState.map((choice) => ({
        table: choice.desired.table,
        field: choice.desired.field,
        value: choice.desired.value,
        existingId: choice.existingId ?? null,
      })),
      policy: policyState,
    },
    actions,
  };

  return {
    internalPlan,
    planDigest: digest(internalPlan),
    state: { groupId, groupMemberPresent, classId, serviceId, offeringId, ciId, choiceState, policyState },
    safe: {
      schemaVersion: 'nvs.staging-fixture-bootstrap-result/v1',
      result: 'PASS',
      operation: 'plan',
      digest: digest(internalPlan),
      plannedActions: actions,
      existingCounts: {
        assignmentGroups: groupId ? 1 : 0,
        ciClasses: classId ? 1 : 0,
        services: serviceId ? 1 : 0,
        offerings: offeringId ? 1 : 0,
        configurationItems: ciId ? 1 : 0,
        choices: choiceState.filter((choice) => choice.existingId).length,
        publishedSlaPolicies: policyState.kind === 'PUBLISHED' ? 1 : 0,
      },
      targetNames: {
        assignmentGroup: DESIRED.group.name,
        ciClass: DESIRED.ciClass.name,
        service: DESIRED.service.name,
        offering: DESIRED.offering.name,
        configurationItem: DESIRED.ci.name,
        slaPolicy: DESIRED.sla.name,
      },
    },
  };
}

function key(planDigest, action) {
  return `nvs-m1-02b-${action}-${planDigest.slice(0, 20)}`;
}

async function createResource(context, session, pathname, body, action, scope) {
  const payload = asRecord(
    await api(context, session, 'POST', pathname, body, key(context.planDigest, action), scope),
  );
  return requireUuid(scope, payload?.id ?? asRecord(payload?.response)?.targetId);
}

async function ensurePublishedPolicy(context, serviceId, current) {
  const { admin, manager } = context.sessions;
  if (current.kind === 'PUBLISHED') {
    return { runtimeDefinitionId: current.runtimeDefinitionId, disposition: 'REUSED' };
  }

  let revisionId = current.kind === 'DRAFT' ? current.revisionId : undefined;
  if (!revisionId) {
    const created = asRecord(
      await api(
        context,
        admin,
        'POST',
        '/grc/itsm/sla/governed/policies',
        {
          changeReason: 'Create dedicated NVS staging Incident SLA fixture',
          snapshot: policySnapshot(serviceId),
        },
        key(context.planDigest, 'sla-create'),
        'create governed SLA draft',
      ),
    );
    revisionId = requireUuid('governed SLA revision', asRecord(created?.response)?.targetId);
  }

  const approvalsPayload = await api(
    context,
    admin,
    'GET',
    `/grc/itsm/sla/governed/revisions/${revisionId}/approval-requests`,
    undefined,
    undefined,
    'list governed SLA approval requests',
  );
  const approvals = arrayFrom(approvalsPayload, 'approvalRequests').map(asRecord).filter(Boolean);
  let approval = approvals.find((candidate) => candidate.status === 'APPROVED');
  if (!approval) approval = approvals.find((candidate) => candidate.status === 'PENDING');
  let approvalId = approval ? requireUuid('SLA approval request', approval.id) : undefined;

  if (!approvalId) {
    const requested = asRecord(
      await api(
        context,
        admin,
        'POST',
        `/grc/itsm/sla/governed/revisions/${revisionId}/publish-requests`,
        {
          changeReason: 'Request publish approval for NVS staging SLA fixture',
          requestReason: 'Dedicated synthetic validation fixture is ready for four-eyes review',
        },
        key(context.planDigest, 'sla-publish-request'),
        'request governed SLA publish approval',
      ),
    );
    approvalId = requireUuid('SLA approval request', asRecord(requested?.response)?.targetId);
    approval = { id: approvalId, status: 'PENDING' };
  }

  if (approval.status !== 'APPROVED') {
    await api(
      context,
      manager,
      'POST',
      `/grc/itsm/sla/governed/publish-requests/${approvalId}/approve`,
      {
        changeReason: 'Approve dedicated NVS staging SLA fixture',
        decisionReason: 'Reviewed as an isolated synthetic validation commitment',
      },
      key(context.planDigest, 'sla-approve'),
      'approve governed SLA publish request',
    );
  }

  await api(
    context,
    admin,
    'POST',
    `/grc/itsm/sla/governed/revisions/${revisionId}/publish`,
    {
      changeReason: 'Publish dedicated NVS staging SLA fixture',
      approvalRequestId: approvalId,
      acknowledgement: 'PUBLISH_SLA_POLICY',
    },
    key(context.planDigest, 'sla-publish'),
    'publish governed SLA revision',
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const policies = arrayFrom(
      await api(
        context,
        admin,
        'GET',
        '/grc/itsm/sla/governed/policies',
        undefined,
        undefined,
        'verify governed SLA publication',
      ),
      'policies',
    );
    const match = requireUnique(
      'published governed SLA policy',
      exactMatches(policies, 'policyName', DESIRED.sla.name),
    );
    const runtimeDefinitionId = safeString(asRecord(match?.publishedRevisionSummary)?.runtimeDefinitionId);
    if (runtimeDefinitionId) {
      return { runtimeDefinitionId: requireUuid('published SLA runtime definition', runtimeDefinitionId), disposition: current.kind === 'MISSING' ? 'CREATED' : 'PUBLISHED' };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new BootstrapError('SLA_PUBLISH_NOT_OBSERVED', 'The governed SLA publication was not observable within its deadline.');
}

async function atomicInventory(payload) {
  const directory = path.dirname(INVENTORY_PATH);
  await mkdir(directory, { recursive: true });
  const temporary = `${INVENTORY_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, INVENTORY_PATH);
  await chmod(INVENTORY_PATH, 0o600);
}

async function applyPlan(context, plan) {
  const { admin, serviceDesk } = context.sessions;
  context.planDigest = plan.planDigest;
  const effects = [];

  let groupId = plan.state.groupId;
  if (!groupId) {
    groupId = await createResource(
      context,
      admin,
      '/grc/groups',
      DESIRED.group,
      'group-create',
      'create assignment group',
    );
    effects.push({ resource: 'assignmentGroup', disposition: 'CREATED' });
  } else {
    effects.push({ resource: 'assignmentGroup', disposition: 'REUSED' });
  }

  if (!plan.state.groupMemberPresent) {
    await api(
      context,
      admin,
      'POST',
      `/grc/groups/${groupId}/members`,
      { userId: serviceDesk.userId },
      key(plan.planDigest, 'group-member'),
      'add Service Desk group member',
    );
    effects.push({ resource: 'assignmentGroupMembership', disposition: 'CREATED' });
  } else {
    effects.push({ resource: 'assignmentGroupMembership', disposition: 'REUSED' });
  }

  let classId = plan.state.classId;
  if (!classId) {
    classId = await createResource(
      context,
      admin,
      '/grc/cmdb/classes',
      { ...DESIRED.ciClass, isAbstract: false, isActive: true, sortOrder: 900 },
      'ci-class-create',
      'create CI class',
    );
    effects.push({ resource: 'ciClass', disposition: 'CREATED' });
  } else {
    effects.push({ resource: 'ciClass', disposition: 'REUSED' });
  }

  let serviceId = plan.state.serviceId;
  if (!serviceId) {
    serviceId = await createResource(
      context,
      admin,
      '/grc/cmdb/services',
      { ...DESIRED.service, ownerUserId: serviceDesk.userId },
      'service-create',
      'create CMDB service',
    );
    effects.push({ resource: 'service', disposition: 'CREATED' });
  } else {
    effects.push({ resource: 'service', disposition: 'REUSED' });
  }

  for (const choice of plan.state.choiceState) {
    if (choice.existingId) {
      effects.push({ resource: `choice:${choice.desired.field}`, disposition: 'REUSED' });
      continue;
    }
    await createResource(
      context,
      admin,
      '/grc/itsm/choices',
      { ...choice.desired, isActive: true },
      `choice-${choice.desired.field}`,
      `create ${choice.desired.field} choice`,
    );
    effects.push({ resource: `choice:${choice.desired.field}`, disposition: 'CREATED' });
  }

  const policy = await ensurePublishedPolicy(context, serviceId, plan.state.policyState);
  effects.push({ resource: 'slaPolicy', disposition: policy.disposition });

  let offeringId = plan.state.offeringId;
  if (!offeringId) {
    offeringId = await createResource(
      context,
      admin,
      '/grc/cmdb/service-offerings',
      {
        serviceId,
        ...DESIRED.offering,
        defaultSlaProfileId: policy.runtimeDefinitionId,
      },
      'offering-create',
      'create service offering',
    );
    effects.push({ resource: 'offering', disposition: 'CREATED' });
  } else {
    effects.push({ resource: 'offering', disposition: 'REUSED' });
  }

  let ciId = plan.state.ciId;
  if (!ciId) {
    ciId = await createResource(
      context,
      admin,
      '/grc/cmdb/cis',
      { ...DESIRED.ci, classId, ownerUserId: serviceDesk.userId },
      'ci-create',
      'create configuration item',
    );
    effects.push({ resource: 'configurationItem', disposition: 'CREATED' });
  } else {
    effects.push({ resource: 'configurationItem', disposition: 'REUSED' });
  }

  await atomicInventory({
    schemaVersion: 'nvs.staging-fixture-bootstrap-inventory/v1',
    environmentId: ENVIRONMENT_ID,
    tenantId: context.tenantId,
    appliedAt: new Date().toISOString(),
    digest: plan.planDigest,
    resources: {
      assignmentGroupId: groupId,
      serviceDeskUserId: serviceDesk.userId,
      ciClassId: classId,
      serviceId,
      offeringId,
      configurationItemId: ciId,
      slaRuntimeDefinitionId: policy.runtimeDefinitionId,
      choices: plan.state.choiceState.map((choice) => ({
        table: choice.desired.table,
        field: choice.desired.field,
        value: choice.desired.value,
      })),
    },
    effects,
  });

  return {
    schemaVersion: 'nvs.staging-fixture-bootstrap-result/v1',
    result: 'PASS',
    operation: 'apply',
    digest: plan.planDigest,
    effects,
    inventoryStoredPrivately: true,
  };
}

async function loadContext() {
  if (!['plan', 'apply'].includes(OPERATION)) {
    throw new BootstrapError('BOOTSTRAP_OPERATION_INVALID', 'Bootstrap operation must be plan or apply.');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(ENVIRONMENT_ID)) {
    throw new BootstrapError('ENVIRONMENT_IDENTIFIER_INVALID', 'The NVS environment identifier is invalid.');
  }
  const environments = await readYamlDirectory(path.join(CONFIG_DIR, 'environments'));
  const environment = environments.find((candidate) => candidate.id === ENVIRONMENT_ID);
  const baseUrl = safeString(environment?.baseUrl);
  if (!baseUrl || environment?.kind === 'production') {
    throw new BootstrapError('ENVIRONMENT_INVALID', 'Bootstrap requires a configured non-production environment.');
  }
  const profiles = await readYamlDirectory(path.join(CONFIG_DIR, 'actors', 'profiles'));
  const profile = (persona) =>
    profiles.find(
      (candidate) =>
        candidate.environmentId === ENVIRONMENT_ID &&
        candidate.persona === persona &&
        candidate.enabled !== false,
    );
  const adminProfile = profile('tenant-admin');
  const managerProfile = profile('incident-manager');
  const serviceDeskProfile = profile('service-desk-agent');
  if (!adminProfile || !managerProfile || !serviceDeskProfile) {
    throw new BootstrapError('ACTOR_PROFILE_MISSING', 'Required staging actor profiles are unavailable.');
  }
  const tenantId = requireUuid('fixture tenant', adminProfile.tenantId);
  for (const actor of [adminProfile, managerProfile, serviceDeskProfile]) {
    if (!actor.credentialRef || actor.tenantId !== tenantId) {
      throw new BootstrapError('ACTOR_PROFILE_INVALID', 'A required staging actor profile is invalid.');
    }
  }
  const sessions = {
    admin: await login(baseUrl, adminProfile, tenantId),
    manager: await login(baseUrl, managerProfile, tenantId),
    serviceDesk: await login(baseUrl, serviceDeskProfile, tenantId),
  };
  return { baseUrl, tenantId, sessions };
}

async function main() {
  const context = await loadContext();
  try {
    const plan = await discover(context);
    if (OPERATION === 'plan') {
      console.log(JSON.stringify(plan.safe));
      return;
    }
    if (!/^[a-f0-9]{64}$/u.test(EXPECTED_DIGEST) || EXPECTED_DIGEST !== plan.planDigest) {
      throw new BootstrapError('BOOTSTRAP_DIGEST_MISMATCH', 'The supplied bootstrap digest does not match current staging state.');
    }
    if (CONFIRMATION !== APPLY_CONFIRMATION) {
      throw new BootstrapError('BOOTSTRAP_CONFIRMATION_REQUIRED', 'Bootstrap apply requires the exact confirmation phrase.');
    }
    console.log(JSON.stringify(await applyPlan(context, plan)));
  } finally {
    for (const session of Object.values(context.sessions)) {
      session.accessToken = '';
    }
  }
}

main().catch((error) => {
  const safe =
    error instanceof BootstrapError
      ? {
          schemaVersion: 'nvs.staging-fixture-bootstrap-result/v1',
          result: error.code.startsWith('BOOTSTRAP_') || error.code.includes('DISABLED') ? 'BLOCKED' : 'FAIL',
          operation: OPERATION,
          error: {
            code: error.code,
            message: error.message,
            ...(typeof error.httpStatus === 'number' ? { httpStatus: error.httpStatus } : {}),
          },
        }
      : {
          schemaVersion: 'nvs.staging-fixture-bootstrap-result/v1',
          result: 'FAIL',
          operation: OPERATION,
          error: {
            code: 'BOOTSTRAP_INTERNAL_ERROR',
            message: 'The staging fixture bootstrap could not complete safely.',
          },
        };
  console.log(JSON.stringify(safe));
  process.exitCode = safe.result === 'BLOCKED' ? 2 : 1;
});
