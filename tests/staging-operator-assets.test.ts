import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const operatorWorkflowPath = path.join(root, '.github', 'workflows', 'staging-operator.yml');
const fixtureWorkflowPath = path.join(root, '.github', 'workflows', 'staging-fixture.yml');
const acceptanceWorkflowPath = path.join(
  root,
  '.github',
  'workflows',
  'staging-live-acceptance.yml',
);
const hostOperatorPath = path.join(root, 'ops', 'staging-operator.py');
const discoveryStorePath = path.join(root, 'ops', 'staging-discovery-store.py');
const containerDiscoveryPath = path.join(root, 'ops', 'staging-fixture-discovery.mjs');
const fixturePlanPath = path.join(root, 'ops', 'staging-fixture-plan.py');
const fixtureApplyPath = path.join(root, 'ops', 'staging-fixture-apply.py');
const fixtureApplyGuardPath = path.join(root, 'ops', 'staging-fixture-apply-guard.py');
const livePreflightPath = path.join(root, 'ops', 'staging-live-preflight.py');
const liveAcceptancePath = path.join(root, 'ops', 'staging-live-acceptance.py');

describe('browser-triggered staging operator assets', () => {
  it('keeps the read-only staging workflow manual, main-pinned, and non-mutating', () => {
    const workflow = readFileSync(operatorWorkflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('- verify');
    expect(workflow).toContain('- discover');
    expect(workflow).toContain('ops/staging-discovery-store.py');
    expect(workflow).toContain('/opt/nvs/releases/nvs-fixture-discovery-latest.json');
    expect(workflow).not.toContain("staging-operator.py' discover");
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('NVS_ENABLE_NILES_MUTATIONS=true');
    expect(workflow).not.toContain('set -x');
  });

  it('keeps fixture planning and application explicit, main-pinned, and mutation-disabled', () => {
    const workflow = readFileSync(fixtureWorkflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('- plan');
    expect(workflow).toContain('- apply');
    expect(workflow).toContain('APPLY_M1_02B_FIXTURE');
    expect(workflow).toContain('staging-fixture-apply-guard.py');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('NVS_ENABLE_NILES_MUTATIONS=true');
    expect(workflow).not.toContain('set -x');
  });

  it('requires static fixture readiness, explicit live confirmation, and unconditional cleanup', () => {
    const workflow = readFileSync(acceptanceWorkflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('RUN_M1_02B_LIVE_INCIDENT');
    expect(workflow).toContain('group: nvs-staging-control');
    expect(workflow).toContain('staging-live-preflight.py');
    expect(workflow).toContain('Prove fixture readiness before mutation lease');
    expect(workflow).toContain('force-disable');
    expect(workflow).toContain('if: always()');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('set -x');
  });

  it('parses every Python and Node operator script without generating artifacts', () => {
    for (const pythonPath of [
      hostOperatorPath,
      discoveryStorePath,
      fixturePlanPath,
      fixtureApplyPath,
      fixtureApplyGuardPath,
      livePreflightPath,
      liveAcceptancePath,
    ]) {
      const python = spawnSync(
        'python3',
        [
          '-c',
          'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
          pythonPath,
        ],
        { encoding: 'utf8' },
      );
      expect(python.status, python.stderr).toBe(0);
    }

    const node = spawnSync(process.execPath, ['--check', containerDiscoveryPath], {
      encoding: 'utf8',
    });
    expect(node.status, node.stderr).toBe(0);
  });

  it('keeps credentials, proposal identities, and live record identities out of public output', () => {
    const operatorWorkflow = readFileSync(operatorWorkflowPath, 'utf8');
    const fixtureWorkflow = readFileSync(fixtureWorkflowPath, 'utf8');
    const hostOperator = readFileSync(hostOperatorPath, 'utf8');
    const discoveryStore = readFileSync(discoveryStorePath, 'utf8');
    const discovery = readFileSync(containerDiscoveryPath, 'utf8');
    const plan = readFileSync(fixturePlanPath, 'utf8');
    const apply = readFileSync(fixtureApplyPath, 'utf8');
    const guard = readFileSync(fixtureApplyGuardPath, 'utf8');
    const preflight = readFileSync(livePreflightPath, 'utf8');
    const acceptance = readFileSync(liveAcceptancePath, 'utf8');

    expect(discovery).toContain("schemaVersion: 'nvs.staging-fixture-discovery/v1'");
    expect(discovery).toContain('authorization: `Bearer ${accessToken}`');
    expect(discovery).not.toMatch(/console\.(log|error)\([^)]*(accessToken|password|credential)/);
    expect(discoveryStore).toContain('was not written to public GitHub logs');
    expect(plan).toContain('without exposing staging UUIDs or labels');
    expect(plan).not.toContain('print(group)');
    expect(plan).not.toContain('print(service)');
    expect(apply).not.toContain('NVS_ENABLE_NILES_MUTATIONS=true');
    expect(guard).toContain('fixture application requires NVS mutations to remain disabled');
    expect(preflight).toContain('NILES_MUTATIONS_DISABLED');
    expect(preflight).not.toContain('/auth/login');
    expect(acceptance).toContain('No credential, bearer token, raw payload, Incident UUID');
    expect(acceptance).toContain('NVS_ENABLE_NILES_MUTATIONS');
    expect(acceptance).toContain('LEASE_TTL_SECONDS');
    expect(acceptance).toContain('RECOVERY_REQUIRED');
    expect(acceptance).not.toMatch(/print\(\s*(accessToken|password|credential)\b/);
    expect(operatorWorkflow).toContain('staging-discovery-store.py');
    expect(fixtureWorkflow).not.toContain('NVS_ENABLE_NILES_MUTATIONS=true');
    expect(hostOperator).not.toContain('/opt/nvs/.env');
    expect(hostOperator).not.toContain('Authorization');
  });
});
