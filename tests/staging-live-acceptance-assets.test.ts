import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const acceptanceScriptPath = path.join(process.cwd(), 'ops', 'staging-live-acceptance.py');
const preflightScriptPath = path.join(process.cwd(), 'ops', 'staging-live-preflight.py');

function runPython(scriptPath: string, source: string) {
  return spawnSync('python3', ['-c', source, scriptPath], { encoding: 'utf8' });
}

describe('guarded staging live acceptance helpers', () => {
  it('accepts only the known close-authority blocker with verified deletion', () => {
    const python = runPython(
      acceptanceScriptPath,
      String.raw`
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
`,
    );

    expect(python.status, python.stderr).toBe(0);
  });

  it('changes only the mutation switch and restores it without exposing other env values', () => {
    const python = runPython(
      acceptanceScriptPath,
      String.raw`
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
`,
    );

    expect(python.status, python.stderr).toBe(0);
    expect(python.stdout).not.toContain('preserve-me');
  });

  it('opens the mutation lease only when the switch is the sole static blocker', () => {
    const python = runPython(
      preflightScriptPath,
      String.raw`
import importlib.util
import pathlib
import sys
from types import SimpleNamespace

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("nvs_live_preflight", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

readiness_path = "/api/environments/staging-example/execution-readiness?scenarioId=payment-api-service-degradation&journey=normal"
responses = {
    "/api/version": {"buildSha": "a" * 40},
    "/api/environments": {
        "items": [
            {
                "id": "staging-example",
                "kind": "staging",
                "enabled": True,
                "execution": {
                    "liveApiEnabled": True,
                    "allowedRunTypes": ["COMPILE_ONLY", "LIVE_API"],
                    "fixtureProfileRef": "fixture.incident-payment",
                },
            }
        ]
    },
    "/api/runs/live-active": {"items": []},
    readiness_path: {
        "verdict": "BLOCKED",
        "confirmed": False,
        "mutationEligible": False,
        "checks": [
            {
                "id": "server-mutation-switch",
                "status": "BLOCKED",
                "code": "NILES_MUTATIONS_DISABLED",
            }
        ],
    },
}
module._get = lambda requested: responses[requested]
args = SimpleNamespace(environment_id="staging-example", expected_sha="a" * 40)
assert module._run(args) == 0

responses[readiness_path]["checks"].append(
    {
        "id": "fixture-profile",
        "status": "BLOCKED",
        "code": "NILES_INCIDENT_FIXTURE_MISSING",
    }
)
try:
    module._run(args)
except module.PreflightError as error:
    assert error.code == "STATIC_READINESS_NOT_FIXTURE_READY"
else:
    raise AssertionError("preflight accepted an additional fixture blocker")
`,
    );

    expect(python.status, python.stderr).toBe(0);
  });
});
