import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.join(process.cwd(), 'ops', 'staging-fixture-plan.py');

function runPython(source: string) {
  return spawnSync('python3', ['-c', source, scriptPath], { encoding: 'utf8' });
}

describe('staging fixture assignment-group selection', () => {
  it('prefers one exact active name match', () => {
    const python = runPython(String.raw`
import importlib.util
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("fixture_plan", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

groups = [
    {"id": "11111111-1111-4111-8111-111111111111", "name": "Service Desk", "isActive": True},
    {"id": "22222222-2222-4222-8222-222222222222", "name": "IT Support", "isActive": True},
]
selected, count, mode = module._choose_assignment_group(groups, "service desk")
assert selected["name"] == "Service Desk"
assert count == 2
assert mode == "EXACT_QUERY"
`);

    expect(python.status, python.stderr).toBe(0);
  });

  it('selects the unique canonical support group when the requested label is absent', () => {
    const python = runPython(String.raw`
import importlib.util
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("fixture_plan", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

groups = [
    {"id": "11111111-1111-4111-8111-111111111111", "name": "Finance Approvers", "isActive": True},
    {"id": "22222222-2222-4222-8222-222222222222", "name": "IT Support", "isActive": True},
    {"id": "33333333-3333-4333-8333-333333333333", "name": "Audit Review", "isActive": True},
]
selected, count, mode = module._choose_assignment_group(groups, "service desk")
assert selected["name"] == "IT Support"
assert count == 3
assert mode == "CANONICAL_RANK_FALLBACK"
`);

    expect(python.status, python.stderr).toBe(0);
  });

  it('uses a legacy label for zero active groups, accepts the sole active group, and blocks ambiguity', () => {
    const python = runPython(String.raw`
import importlib.util
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("fixture_plan", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

sole = [
    {"id": "11111111-1111-4111-8111-111111111111", "name": "Routing Team", "isActive": True},
    {"id": "22222222-2222-4222-8222-222222222222", "name": "Old Team", "isActive": False},
]
selected, count, mode = module._choose_assignment_group(sole, "service desk")
assert selected["name"] == "Routing Team"
assert count == 2
assert mode == "SOLE_ACTIVE_FALLBACK"

selected, count, mode = module._choose_assignment_group([], "service desk")
assert selected == {"mode": "LEGACY_LABEL", "label": "NVS Service Desk"}
assert count == 0
assert mode == "LEGACY_LABEL_FALLBACK"

ambiguous = [
    {"id": "33333333-3333-4333-8333-333333333333", "name": "Support Alpha", "isActive": True},
    {"id": "44444444-4444-4444-8444-444444444444", "name": "Support Beta", "isActive": True},
]
try:
    module._choose_assignment_group(ambiguous, "service desk")
except module.PlanError as error:
    assert "could not choose uniquely" in str(error)
else:
    raise AssertionError("ambiguous assignment groups must remain blocked")
`);

    expect(python.status, python.stderr).toBe(0);
  });
});
