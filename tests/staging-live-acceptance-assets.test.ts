import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.join(process.cwd(), 'ops', 'staging-live-acceptance.py');

function runPython(source: string) {
  return spawnSync('python3', ['-c', source, scriptPath], { encoding: 'utf8' });
}

describe('guarded staging live acceptance helpers', () => {
  it('accepts only the known close-authority blocker with verified deletion', () => {
    const python = runPython(String.raw`
import importlib.util
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("nvs_live_acceptance", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

close_blocked = {
    "verdict": "BLOCKED",
    "error": {"code": "NILES_CLOSE_AUTHORITY_UNSATISFIABLE"},
    "cleanup": {"status": "CLEAN", "policy": "DELETE_IF_RUN_OWNED"},
    "resourceInventory": {"incident": {"disposition": "DELETED"}},
    "stepResults": [
        {"stepId": "create", "executionStatus": "PASS", "required": True},
        {
            "stepId": "close",
            "executionStatus": "BLOCKED",
            "required": True,
            "error": {"code": "NILES_CLOSE_AUTHORITY_UNSATISFIABLE"},
        },
    ],
}
classification, accepted, summary = module._classify(close_blocked)
assert classification == "ACCEPTED_WITH_PRODUCT_BLOCKER"
assert accepted is True
assert summary["incidentDisposition"] == "DELETED"

unsafe_blocked = {
    **close_blocked,
    "error": {"code": "SLA_SUMMARY_MISSING"},
    "stepResults": [
        {"stepId": "create", "executionStatus": "PASS", "required": True},
        {
            "stepId": "sla",
            "executionStatus": "BLOCKED",
            "required": True,
            "error": {"code": "SLA_SUMMARY_MISSING"},
        },
    ],
}
classification, accepted, _summary = module._classify(unsafe_blocked)
assert classification == "NOT_ACCEPTED"
assert accepted is False
`);

    expect(python.status, python.stderr).toBe(0);
  });

  it('changes only the mutation switch and restores it without exposing other env values', () => {
    const python = runPython(String.raw`
import importlib.util
import os
import pathlib
import stat
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("nvs_live_acceptance", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as directory:
    env_path = pathlib.Path(directory) / ".env"
    env_path.write_text("NVS_LOG_LEVEL=info\nPRIVATE_TEST_VALUE=preserve-me\nNVS_ENABLE_NILES_MUTATIONS=false\n", encoding="utf-8")
    os.chmod(env_path, 0o600)
    module.ENV_FILE = env_path

    module._rewrite_switch(True)
    enabled = env_path.read_text(encoding="utf-8")
    assert "PRIVATE_TEST_VALUE=preserve-me" in enabled
    assert enabled.count("NVS_ENABLE_NILES_MUTATIONS=true") == 1
    assert stat.S_IMODE(env_path.stat().st_mode) == 0o600

    module._rewrite_switch(False)
    restored = env_path.read_text(encoding="utf-8")
    assert "PRIVATE_TEST_VALUE=preserve-me" in restored
    assert restored.count("NVS_ENABLE_NILES_MUTATIONS=false") == 1
    assert "NVS_ENABLE_NILES_MUTATIONS=true" not in restored
`);

    expect(python.status, python.stderr).toBe(0);
    expect(python.stdout).not.toContain('preserve-me');
  });
});
