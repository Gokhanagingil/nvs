import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'staging-operator.yml');
const hostOperatorPath = path.join(root, 'ops', 'staging-operator.py');
const containerDiscoveryPath = path.join(root, 'ops', 'staging-fixture-discovery.mjs');

describe('browser-triggered staging operator assets', () => {
  it('keeps the staging workflow manual, main-pinned, and non-mutating', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('- verify');
    expect(workflow).toContain('- discover');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('NVS_ENABLE_NILES_MUTATIONS=true');
    expect(workflow).not.toContain('set -x');
  });

  it('parses the Python and Node operator scripts without generating artifacts', () => {
    const python = spawnSync(
      'python3',
      [
        '-c',
        'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
        hostOperatorPath,
      ],
      { encoding: 'utf8' },
    );
    expect(python.status, python.stderr).toBe(0);

    const node = spawnSync(process.execPath, ['--check', containerDiscoveryPath], {
      encoding: 'utf8',
    });
    expect(node.status, node.stderr).toBe(0);
  });

  it('never serializes credentials or bearer material into discovery output', () => {
    const hostOperator = readFileSync(hostOperatorPath, 'utf8');
    const discovery = readFileSync(containerDiscoveryPath, 'utf8');

    expect(discovery).toContain("schemaVersion: 'nvs.staging-fixture-discovery/v1'");
    expect(discovery).toContain('authorization: `Bearer ${accessToken}`');
    expect(discovery).not.toMatch(/console\.(log|error)\([^)]*(accessToken|password|credential)/);
    expect(hostOperator).not.toContain('/opt/nvs/.env');
    expect(hostOperator).not.toContain('Authorization');
  });
});
