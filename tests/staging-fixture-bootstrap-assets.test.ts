import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'staging-fixture-bootstrap.yml');
const scriptPath = path.join(root, 'ops', 'staging-fixture-bootstrap.mjs');

const workflow = () => readFileSync(workflowPath, 'utf8');
const script = () => readFileSync(scriptPath, 'utf8');

describe('staging fixture bootstrap assets', () => {
  it('keeps bootstrap manual, main-pinned, staging-scoped, and mutually exclusive', () => {
    const source = workflow();

    expect(source).toContain('workflow_dispatch:');
    expect(source).toContain("if: github.ref == 'refs/heads/main'");
    expect(source).toContain('ref: main');
    expect(source).toContain('environment: staging');
    expect(source).toContain('group: nvs-staging-control');
    expect(source).toContain('- plan');
    expect(source).toContain('- apply');
    expect(source).toContain('BOOTSTRAP_M1_02B_FIXTURES');
    expect(source).not.toContain('pull_request:');
    expect(source).not.toContain('NVS_ENABLE_NILES_MUTATIONS=true');
    expect(source).not.toContain('set -x');
  });

  it('requires the exact deployed build and a disabled NVS mutation switch', () => {
    const source = workflow();

    expect(source).toContain('http://127.0.0.1:4100/api/version');
    expect(source).toContain('NVS_ENABLE_NILES_MUTATIONS');
    expect(source).toContain(String.raw`[[ \"\$mutation\" != true ]]`);
    expect(source).toContain('expected_sha');
    expect(source).toContain('bootstrap_digest');
  });

  it('uses deterministic, idempotent public NILES configuration contracts', () => {
    const source = script();

    expect(source).toContain("name: 'NVS Service Desk'");
    expect(source).toContain("name: 'NVS Payment API'");
    expect(source).toContain("name: 'NVS Payment API Standard'");
    expect(source).toContain("name: 'NVS-PAYMENT-API-STG'");
    expect(source).toContain("name: 'NVS Payment API Incident SLA'");
    expect(source).toContain("value: 'pending_external_dependency'");
    expect(source).toContain("value: 'affected_by'");
    expect(source).toContain("value: 'service_impacting'");
    expect(source).toContain("'Idempotency-Key': idempotencyKey");
    expect(source).toContain("acknowledgement: 'PUBLISH_SLA_POLICY'");
    expect(source).toContain('/publish-requests/${approvalId}/approve');
    expect(source).toContain("operator: 'is', value: serviceId");
    expect(source).toContain("stopOnStates: ['closed', 'resolved']");
    expect(source).not.toContain("stopOnStates: ['resolved', 'closed']");
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
  });

  it('is resume-safe and never performs broad deletion or exposes private inventory', () => {
    const source = script();
    const workflowSource = workflow();

    expect(source).toContain('BOOTSTRAP_DUPLICATE_RESOURCE');
    expect(source).toContain('BOOTSTRAP_DIGEST_MISMATCH');
    expect(source).toContain('INVENTORY_PATH');
    expect(source).toContain('mode: 0o600');
    expect(source).not.toContain("method: 'DELETE'");
    expect(source).not.toContain("'DELETE',");
    expect(workflowSource).not.toContain('/app/data/bootstrap/staging-fixture-bootstrap.json');
    expect(workflowSource).not.toContain('/opt/nvs/.env');
    expect(workflowSource).toContain('No live UUID, credential, bearer token');
  });

  it('parses with the pinned Node runtime', () => {
    const result = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
});
