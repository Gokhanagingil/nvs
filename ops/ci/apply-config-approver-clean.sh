#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee /tmp/config-approver-apply.log) 2>&1

git config user.name 'nvs-maintenance-bot'
git config user.email 'nvs-maintenance-bot@users.noreply.github.com'
git fetch --quiet origin fix/bootstrap-configuration-approver
pnpm install --frozen-lockfile --reporter=silent

mkdir -p tools
git show \
  origin/fix/bootstrap-configuration-approver:tools/apply-bootstrap-configuration-approver-v2.py \
  > tools/.tmp-apply-bootstrap-configuration-approver.py

python3 - <<'PY'
from pathlib import Path

patch = Path('tools/.tmp-apply-bootstrap-configuration-approver.py')
text = patch.read_text(encoding='utf-8')


def remove_to_next(
    text: str,
    start_marker: str,
    end_marker: str,
    label: str,
    *,
    skip: int = 0,
) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label} start was not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise SystemExit(f'{label} end was not found')
    return text[:start] + text[end + skip:]


text = remove_to_next(
    text,
    '''replace_once(
    bootstrap,
    """async function atomicInventory(payload) {''',
    '\n\nreplace_once(',
    'atomicInventory patch block',
    skip=2,
)
text = remove_to_next(
    text,
    '''regex_once(
    bootstrap,
    r"  const adminProfile = profile\\('tenant-admin'\\);''',
    '\nreplace_once(\n    bootstrap,\n    """    for (const session of [',
    'legacy loadContext patch block',
)
text = remove_to_next(
    text,
    '''replace_once(
    bootstrap,
    """    for (const session of [''',
    '\n\ntest = "tests/staging-fixture-bootstrap-assets.test.ts"',
    'legacy session cleanup patch block',
    skip=2,
)
patch.write_text(text, encoding='utf-8')
PY

python3 tools/.tmp-apply-bootstrap-configuration-approver.py

python3 - <<'PY'
from pathlib import Path
import re

target = Path('ops/staging-fixture-bootstrap.mjs')
text = target.read_text(encoding='utf-8')

atomic_pattern = (
    r"async function atomicInventory\(payload\) \{.*?\n\}\n\n"
    r"async function applyPlan"
)
atomic_replacement = """async function atomicInventory(payload) {
  await writePrivateJson(INVENTORY_PATH, payload);
}

async function applyPlan"""
text, atomic_count = re.subn(
    atomic_pattern,
    atomic_replacement,
    text,
    count=1,
    flags=re.DOTALL,
)
if atomic_count != 1:
    raise SystemExit(f'atomicInventory source replacement count={atomic_count}')

context_pattern = r"""  const adminProfile = profile\('tenant-admin'\);
  const managerProfile = profile\('incident-manager'\);
  const serviceDeskProfile = profile\('service-desk-agent'\);
  if \(!adminProfile \|\| !managerProfile \|\| !serviceDeskProfile\) \{
.*?
  const sessions = \{
    admin: await login\(baseUrl, adminProfile, tenantId\),
    manager: await login\(baseUrl, managerProfile, tenantId\),
    serviceDesk: await login\(baseUrl, serviceDeskProfile, tenantId\),
  \};
  return \{ baseUrl, tenantId, sessions \};
"""
context_replacement = """  const adminProfile = profile('tenant-admin');
  const serviceDeskProfile = profile('service-desk-agent');
  if (!adminProfile || !serviceDeskProfile) {
    throw new BootstrapError(
      'ACTOR_PROFILE_MISSING',
      'Required staging actor profiles are unavailable.',
    );
  }
  const tenantId = requireUuid('fixture tenant', adminProfile.tenantId);
  for (const actor of [adminProfile, serviceDeskProfile]) {
    if (!actor.credentialRef || actor.tenantId !== tenantId) {
      throw new BootstrapError(
        'ACTOR_PROFILE_INVALID',
        'A required staging actor profile is invalid.',
      );
    }
  }
  const sessions = {
    admin: await login(baseUrl, adminProfile, tenantId),
    serviceDesk: await login(baseUrl, serviceDeskProfile, tenantId),
  };
  return { baseUrl, tenantId, sessions };
"""
text, context_count = re.subn(
    context_pattern,
    context_replacement,
    text,
    count=1,
    flags=re.DOTALL,
)
if context_count != 1:
    raise SystemExit(f'loadContext source replacement count={context_count}')

find_present = 'async function findConfigurationApprover(context)' in text
ensure_present = 'async function ensureConfigurationApprover(context, current)' in text
if find_present != ensure_present:
    raise SystemExit('configuration approver helper insertion is partially present')
if not find_present:
    marker = 'async function applyPlan(context, plan) {'
    helpers = """async function findConfigurationApprover(context) {
  const payload = await api(
    context,
    context.sessions.admin,
    'GET',
    `/users?page=1&limit=100&search=${encodeURIComponent(configurationApproverEmail(context.tenantId))}`,
    undefined,
    undefined,
    'find configuration approver',
  );
  const match = requireUnique(
    'configuration approver user',
    exactMatches(
      arrayFrom(payload, 'users'),
      'email',
      configurationApproverEmail(context.tenantId),
    ),
  );
  return match ? validateConfigurationApproverUser(match, context.tenantId) : undefined;
}

async function ensureConfigurationApprover(context, current) {
  let credential = await readConfigurationApproverCredential(context.tenantId);
  let created = false;
  if (!credential) {
    credential = {
      email: configurationApproverEmail(context.tenantId),
      password: generateConfigurationApproverPassword(),
      state: 'PENDING',
    };
    await writePrivateJson(APPROVER_CREDENTIAL_PATH, {
      schemaVersion: APPROVER_CREDENTIAL_SCHEMA,
      tenantId: context.tenantId,
      email: credential.email,
      password: credential.password,
      state: 'PENDING',
      createdAt: new Date().toISOString(),
    });
  }

  let user = await findConfigurationApprover(context);
  if (!user) {
    try {
      const createdPayload = await api(
        context,
        context.sessions.admin,
        'POST',
        '/users',
        {
          email: credential.email,
          password: credential.password,
          firstName: 'NVS',
          lastName: 'Configuration Approver',
          department: 'NVS Validation',
          role: 'admin',
          isActive: true,
          isGlobalAdmin: false,
          domainAccessGrc: false,
          domainAccessItsm: true,
          domainAccessSpace: false,
          mustChangePassword: false,
        },
        undefined,
        'create configuration approver',
      );
      user = validateConfigurationApproverUser(createdPayload, context.tenantId);
      created = true;
    } catch (error) {
      for (let attempt = 0; attempt < 20 && !user; attempt += 1) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
        user = await findConfigurationApprover(context);
      }
      if (!user) throw error;
    }
  }

  if (user.id === context.sessions.admin.userId) {
    throw new BootstrapError(
      'CONFIGURATION_APPROVER_SELF_APPROVAL_FORBIDDEN',
      'The configuration approver must be distinct from the governed SLA requester.',
    );
  }
  const session = await loginConfigurationApprover(context, credential);
  if (session.userId !== user.id) {
    clearSession(session);
    throw new BootstrapError(
      'CONFIGURATION_APPROVER_IDENTITY_MISMATCH',
      'The configuration approver credential resolved to an unexpected user.',
    );
  }
  await writePrivateJson(APPROVER_CREDENTIAL_PATH, {
    schemaVersion: APPROVER_CREDENTIAL_SCHEMA,
    tenantId: context.tenantId,
    email: credential.email,
    password: credential.password,
    state: 'READY',
    userId: user.id,
    verifiedAt: new Date().toISOString(),
  });
  credential.password = '';
  return {
    session,
    userId: user.id,
    disposition: created ? 'CREATED' : current.kind === 'READY' ? 'REUSED' : 'RECOVERED',
  };
}

"""
    if text.count(marker) != 1:
        raise SystemExit(f'applyPlan helper insertion marker count={text.count(marker)}')
    text = text.replace(marker, helpers + marker, 1)

# Enforce the actual frozen CreateUserDto field names and least-privilege domains.
legacy_access = "          hasItsmAccess: true,\n"
if legacy_access in text:
    text = text.replace(
        legacy_access,
        """          domainAccessGrc: false,
          domainAccessItsm: true,
          domainAccessSpace: false,
""",
        1,
    )
if 'hasItsmAccess:' in text:
    raise SystemExit('retired hasItsmAccess field remains in bootstrap source')
for required in (
    'domainAccessGrc: false',
    'domainAccessItsm: true',
    'domainAccessSpace: false',
):
    if required not in text:
        raise SystemExit(f'missing least-privilege user field: {required}')

target.write_text(text, encoding='utf-8')

test_path = Path('tests/staging-fixture-bootstrap-assets.test.ts')
test_text = test_path.read_text(encoding='utf-8')
needle = "    expect(source).toContain('mustChangePassword: false');\n"
replacement = """    expect(source).toContain('mustChangePassword: false');
    expect(source).toContain('domainAccessGrc: false');
    expect(source).toContain('domainAccessItsm: true');
    expect(source).toContain('domainAccessSpace: false');
    expect(source).not.toContain('hasItsmAccess:');
"""
if needle not in test_text:
    raise SystemExit('user DTO regression insertion point was not found')
test_path.write_text(test_text.replace(needle, replacement, 1), encoding='utf-8')
PY

rm -f \
  tools/.tmp-apply-bootstrap-configuration-approver.py \
  .github/workflows/one-shot-config-approver-v7.yml

pnpm exec prettier --write \
  ops/staging-fixture-bootstrap.mjs \
  tests/staging-fixture-bootstrap-assets.test.ts \
  docs/operations/STAGING_FIXTURE_BOOTSTRAP.md
node --check ops/staging-fixture-bootstrap.mjs
pnpm exec eslint \
  ops/staging-fixture-bootstrap.mjs \
  tests/staging-fixture-bootstrap-assets.test.ts
pnpm exec vitest run tests/staging-fixture-bootstrap-assets.test.ts
pnpm run typecheck
git diff --check

python3 - <<'PY'
import subprocess

allowed = {
    '.github/workflows/one-shot-config-approver-v7.yml',
    'docs/operations/STAGING_FIXTURE_BOOTSTRAP.md',
    'ops/staging-fixture-bootstrap.mjs',
    'tests/staging-fixture-bootstrap-assets.test.ts',
}
changed = {
    line[3:]
    for line in subprocess.check_output(['git', 'status', '--short'], text=True).splitlines()
    if len(line) >= 4
}
unexpected = sorted(changed - allowed)
required = {
    'docs/operations/STAGING_FIXTURE_BOOTSTRAP.md',
    'ops/staging-fixture-bootstrap.mjs',
    'tests/staging-fixture-bootstrap-assets.test.ts',
}
missing = sorted(required - changed)
if unexpected or missing:
    raise SystemExit(
        f'unexpected={unexpected}; missing_required={missing}; changed={sorted(changed)}'
    )
PY

git add \
  .github/workflows/one-shot-config-approver-v7.yml \
  docs/operations/STAGING_FIXTURE_BOOTSTRAP.md \
  ops/staging-fixture-bootstrap.mjs \
  tests/staging-fixture-bootstrap-assets.test.ts
git commit -m 'fix: provision distinct governed SLA configuration approver'
git push --force-with-lease origin HEAD:fix/bootstrap-configuration-approver-clean
