import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const CONFIG_DIR = process.env.NVS_CONFIG_DIR || '/app/config';
const environmentId = process.env.NVS_DISCOVERY_ENVIRONMENT_ID || 'staging-example';
const commonQuery = (process.env.NVS_DISCOVERY_QUERY || '').trim();
const REQUEST_TIMEOUT_MS = 8_000;

function scopedQuery(environmentName) {
  const value = process.env[environmentName];
  return (value === undefined ? commonQuery : value).trim();
}

const queries = Object.freeze({
  assignmentGroups: scopedQuery('NVS_DISCOVERY_GROUP_QUERY'),
  services: scopedQuery('NVS_DISCOVERY_SERVICE_QUERY'),
  offerings: scopedQuery('NVS_DISCOVERY_OFFERING_QUERY'),
  configurationItems: scopedQuery('NVS_DISCOVERY_CI_QUERY'),
});

class DiscoveryError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'DiscoveryError';
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

function itemsFrom(value) {
  const payload = unwrapData(value);
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  return Array.isArray(record?.items) ? record.items : [];
}

function scalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  return trimmed;
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
  const entries = await readdir(directory, { withFileTypes: true });
  const documents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/iu.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    documents.push({
      filePath,
      values: parseTopLevelYaml(await readFile(filePath, 'utf8')),
    });
  }
  return documents;
}

function credentialEnvironmentName(reference) {
  if (!/^[A-Za-z0-9._-]+$/u.test(reference)) {
    throw new DiscoveryError(
      'CREDENTIAL_REFERENCE_INVALID',
      'The tenant-admin credential reference contains unsupported characters.',
    );
  }
  let encoded = '';
  for (const character of reference) {
    if (character === '.') encoded += '_DOT_';
    else if (character === '-') encoded += '_DASH_';
    else encoded += character.toUpperCase();
  }
  return `NVS_CREDENTIAL_${encoded}`;
}

function normalizeCredential(raw) {
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
    throw new DiscoveryError(
      'CREDENTIAL_CONFIGURATION_INVALID',
      'The tenant-admin credential is not valid JSON.',
    );
  }
  const record = asRecord(parsed);
  const email = typeof record?.email === 'string' ? record.email.trim() : '';
  const password = typeof record?.password === 'string' ? record.password : '';
  if (!email || !password) {
    throw new DiscoveryError(
      'CREDENTIAL_CONFIGURATION_INVALID',
      'The tenant-admin credential does not contain usable email and password fields.',
    );
  }
  return { email, password };
}

async function readJsonResponse(response, scope) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const status = response.status;
    const code =
      status === 401 || status === 403
        ? 'NILES_AUTHORIZATION_DENIED'
        : status === 404
          ? 'NILES_RESOURCE_MISSING'
          : status === 429
            ? 'NILES_RATE_LIMITED'
            : status >= 500
              ? 'NILES_UPSTREAM_FAILURE'
              : 'NILES_PRODUCT_RULE_REJECTED';
    throw new DiscoveryError(code, `${scope} returned HTTP ${status}.`, status);
  }
  if (payload === undefined) {
    throw new DiscoveryError('NILES_MALFORMED_RESPONSE', `${scope} returned invalid JSON.`);
  }
  return payload;
}

async function fetchJson(url, init, scope) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new DiscoveryError(
      timedOut ? 'NILES_REQUEST_TIMEOUT' : 'NILES_NETWORK_FAILURE',
      timedOut ? `${scope} exceeded its deadline.` : `${scope} could not reach NILES.`,
    );
  }
  return readJsonResponse(response, scope);
}

function safeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function selectGroup(value) {
  const item = asRecord(value);
  const id = safeString(item?.id);
  const name = safeString(item?.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    description: safeString(item.description) || null,
    isActive: safeBoolean(item.isActive) ?? null,
  };
}

function selectService(value) {
  const item = asRecord(value);
  const id = safeString(item?.id);
  const name = safeString(item?.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    status: safeString(item.status) || null,
    type: safeString(item.type) || null,
    tier: safeString(item.tier) || null,
    criticality: safeString(item.criticality) || null,
  };
}

function selectOffering(value) {
  const item = asRecord(value);
  const id = safeString(item?.id);
  const serviceId = safeString(item?.serviceId);
  const name = safeString(item?.name);
  if (!id || !name) return undefined;
  return {
    id,
    serviceId: serviceId || null,
    name,
    status: safeString(item.status) || null,
    supportHours: safeString(item.supportHours) || null,
    defaultSlaProfileId: safeString(item.defaultSlaProfileId) || null,
  };
}

function selectCi(value) {
  const item = asRecord(value);
  const id = safeString(item?.id);
  const name = safeString(item?.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    className: safeString(item.className) || null,
    classLabel: safeString(item.classLabel) || null,
    lifecycle: safeString(item.lifecycle) || null,
    environment: safeString(item.environment) || null,
  };
}

function selectChoice(value) {
  const item = asRecord(value);
  return safeString(item?.value);
}

function sortByName(items) {
  return [...items].sort((left, right) =>
    String(left.name || left.value || left.id).localeCompare(
      String(right.name || right.value || right.id),
      'en',
      { sensitivity: 'base' },
    ),
  );
}

function validateQuery(value, scope) {
  if (value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new DiscoveryError(
      'DISCOVERY_QUERY_INVALID',
      `The ${scope} discovery query is invalid.`,
    );
  }
}

async function main() {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(environmentId)) {
    throw new DiscoveryError(
      'ENVIRONMENT_IDENTIFIER_INVALID',
      'The requested NVS environment identifier is invalid.',
    );
  }
  validateQuery(commonQuery, 'common');
  for (const [scope, value] of Object.entries(queries)) {
    validateQuery(value, scope);
  }

  const environments = await readYamlDirectory(path.join(CONFIG_DIR, 'environments'));
  const environment = environments.find((document) => document.values.id === environmentId)?.values;
  if (!environment) {
    throw new DiscoveryError('ENVIRONMENT_NOT_FOUND', 'The requested NVS environment is not configured.');
  }
  const baseUrl = safeString(environment.baseUrl);
  if (!baseUrl || !/^https?:\/\//u.test(baseUrl)) {
    throw new DiscoveryError('ENVIRONMENT_BASE_URL_INVALID', 'The NILES base URL is invalid.');
  }
  if (environment.kind === 'production') {
    throw new DiscoveryError(
      'PRODUCTION_DISCOVERY_FORBIDDEN',
      'Fixture discovery is forbidden for production environments.',
    );
  }

  const profiles = await readYamlDirectory(path.join(CONFIG_DIR, 'actors', 'profiles'));
  const tenantAdmin = profiles.find(
    (document) =>
      document.values.environmentId === environmentId &&
      document.values.persona === 'tenant-admin' &&
      document.values.enabled !== false,
  )?.values;
  if (!tenantAdmin) {
    throw new DiscoveryError(
      'TENANT_ADMIN_PROFILE_MISSING',
      'An enabled tenant-admin actor profile was not found for this environment.',
    );
  }
  const tenantId = safeString(tenantAdmin.tenantId);
  const credentialRef = safeString(tenantAdmin.credentialRef);
  if (!tenantId || !credentialRef) {
    throw new DiscoveryError(
      'TENANT_ADMIN_PROFILE_INVALID',
      'The tenant-admin actor profile is missing tenant or credential metadata.',
    );
  }

  const credentialName = credentialEnvironmentName(credentialRef);
  const rawCredential = process.env[credentialName];
  if (!rawCredential) {
    throw new DiscoveryError(
      'TENANT_ADMIN_CREDENTIAL_MISSING',
      'The tenant-admin credential is not configured in the NVS container.',
    );
  }
  let credential = normalizeCredential(rawCredential);
  const loginUrl = new URL('/auth/login', baseUrl);
  const loginCorrelationId = `discover_login_${crypto.randomUUID().replaceAll('-', '')}`;
  const loginPayload = await fetchJson(
    loginUrl,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-correlation-id': loginCorrelationId,
      },
      body: JSON.stringify({ email: credential.email, password: credential.password }),
    },
    'tenant-admin login',
  );
  credential = { email: '', password: '' };

  const login = asRecord(unwrapData(loginPayload));
  const accessToken = safeString(login?.accessToken);
  const user = asRecord(login?.user);
  const observedTenantId = safeString(user?.tenantId);
  if (!accessToken || observedTenantId !== tenantId) {
    throw new DiscoveryError(
      observedTenantId ? 'TENANT_MISMATCH' : 'LOGIN_RESPONSE_MALFORMED',
      observedTenantId
        ? 'The tenant-admin login returned an unexpected tenant.'
        : 'The tenant-admin login response was incomplete.',
    );
  }

  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${accessToken}`,
    'x-tenant-id': tenantId,
  };
  const errors = [];

  async function discoverScope(scope, pathname, selector) {
    const url = new URL(pathname, baseUrl);
    try {
      const payload = await fetchJson(
        url,
        {
          method: 'GET',
          headers: {
            ...headers,
            'x-correlation-id': `discover_${scope}_${crypto.randomUUID().replaceAll('-', '')}`,
          },
        },
        scope,
      );
      return itemsFrom(payload).map(selector).filter(Boolean);
    } catch (error) {
      if (error instanceof DiscoveryError) {
        errors.push({
          scope,
          code: error.code,
          ...(typeof error.httpStatus === 'number' ? { httpStatus: error.httpStatus } : {}),
        });
        return [];
      }
      throw error;
    }
  }

  const groupSearch = encodeURIComponent(queries.assignmentGroups);
  const serviceSearch = encodeURIComponent(queries.services);
  const offeringSearch = encodeURIComponent(queries.offerings);
  const ciSearch = encodeURIComponent(queries.configurationItems);
  const assignmentGroups = await discoverScope(
    'assignment-groups',
    `/grc/groups/directory?page=1&pageSize=100${
      queries.assignmentGroups ? `&search=${groupSearch}` : ''
    }`,
    selectGroup,
  );
  const services = await discoverScope(
    'services',
    `/grc/cmdb/services?page=1&pageSize=100${queries.services ? `&search=${serviceSearch}` : ''}`,
    selectService,
  );
  const offerings = await discoverScope(
    'service-offerings',
    `/grc/cmdb/service-offerings?page=1&pageSize=100${
      queries.offerings ? `&search=${offeringSearch}` : ''
    }`,
    selectOffering,
  );
  const configurationItems = await discoverScope(
    'configuration-items',
    `/grc/cmdb/cis/search?limit=100${queries.configurationItems ? `&q=${ciSearch}` : ''}`,
    selectCi,
  );

  async function discoverChoice(field, table) {
    return discoverScope(
      `choice-${table}-${field}`,
      `/grc/itsm/choices?table=${encodeURIComponent(table)}&field=${encodeURIComponent(field)}`,
      selectChoice,
    );
  }

  const pendingReason = await discoverChoice('pendingReason', 'itsm_incidents');
  const relationshipType = await discoverChoice('relationshipType', 'itsm_incident_ci');
  const impactScope = await discoverChoice('impactScope', 'itsm_incident_ci');

  const result = {
    schemaVersion: 'nvs.staging-fixture-discovery/v1',
    environmentId,
    tenantId,
    query: commonQuery,
    queries,
    candidates: {
      assignmentGroups: sortByName(assignmentGroups),
      services: sortByName(services),
      offerings: sortByName(offerings),
      configurationItems: sortByName(configurationItems),
    },
    choices: {
      pendingReason: [...pendingReason].sort(),
      relationshipType: [...relationshipType].sort(),
      impactScope: [...impactScope].sort(),
    },
    errors,
  };
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  const safe =
    error instanceof DiscoveryError
      ? {
          code: error.code,
          message: error.message,
          ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
        }
      : {
          code: 'DISCOVERY_INTERNAL_ERROR',
          message: 'The fixture discovery process could not complete safely.',
        };
  console.error(JSON.stringify({ error: safe }));
  process.exitCode = 1;
});
