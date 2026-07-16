#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

script_path = ROOT / "ops/staging-fixture-bootstrap.mjs"
script = script_path.read_text(encoding="utf-8")
replacements = {
    "'x-correlation-id': `bootstrap_login_${randomUUID().replaceAll('-', '')}`": "'x-correlation-id': randomUUID()",
    "'x-correlation-id': `bootstrap_${randomUUID().replaceAll('-', '')}`": "'x-correlation-id': randomUUID()",
}
for old, new in replacements.items():
    count = script.count(old)
    if count != 1:
        raise RuntimeError(f"expected one bootstrap correlation expression, found {count}: {old}")
    script = script.replace(old, new, 1)
script_path.write_text(script, encoding="utf-8")

test_path = ROOT / "tests/staging-fixture-bootstrap-assets.test.ts"
test = test_path.read_text(encoding="utf-8")
anchor = """    expect(source).toContain(\"acknowledgement: 'PUBLISH_SLA_POLICY'\");
    expect(source).toContain('/publish-requests/${approvalId}/approve');
    expect(source).toContain(\"operator: 'is', value: serviceId\");
"""
replacement = """    expect(source).toContain(\"acknowledgement: 'PUBLISH_SLA_POLICY'\");
    expect(source).toContain('/publish-requests/${approvalId}/approve');
    expect(source).toContain(\"operator: 'is', value: serviceId\");
    expect(source.match(/'x-correlation-id': randomUUID\\(\\)/g)).toHaveLength(2);
    expect(source).not.toContain('bootstrap_${randomUUID');
"""
if test.count(anchor) != 1:
    raise RuntimeError("bootstrap asset-test anchor was not unique")
test_path.write_text(test.replace(anchor, replacement, 1), encoding="utf-8")
