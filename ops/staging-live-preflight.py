#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
BASE_URL = "http://127.0.0.1:4100"
SCENARIO_ID = "payment-api-service-degradation"


class PreflightError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _get(path: str) -> Any:
    request = urllib.request.Request(
        f"{BASE_URL}/{path.lstrip('/')}",
        headers={"accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise PreflightError(
            "NVS_PREFLIGHT_HTTP_FAILURE",
            f"GET {path} returned HTTP {error.code}.",
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise PreflightError(
            "NVS_PREFLIGHT_UNREACHABLE",
            f"GET {path} could not reach the local NVS control plane.",
        ) from error
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PreflightError(
            "NVS_PREFLIGHT_MALFORMED",
            f"GET {path} returned invalid JSON.",
        ) from error


def _run(args: argparse.Namespace) -> int:
    if not SAFE_ID.fullmatch(args.environment_id):
        raise PreflightError("INVALID_ENVIRONMENT_ID", "environment_id is invalid.")
    if not FULL_SHA.fullmatch(args.expected_sha):
        raise PreflightError("INVALID_EXPECTED_SHA", "expected_sha must be a full Git SHA.")

    version = _get("/api/version")
    if not isinstance(version, dict) or version.get("buildSha") != args.expected_sha:
        raise PreflightError(
            "DEPLOYED_SHA_MISMATCH",
            "The running NVS build does not match expected_sha.",
        )

    environments = _get("/api/environments")
    items = environments.get("items") if isinstance(environments, dict) else None
    environment = next(
        (
            item
            for item in items or []
            if isinstance(item, dict) and item.get("id") == args.environment_id
        ),
        None,
    )
    if not isinstance(environment, dict):
        raise PreflightError("ENVIRONMENT_NOT_FOUND", "The requested environment is not loaded.")
    execution = environment.get("execution")
    if environment.get("kind") == "production":
        raise PreflightError("PRODUCTION_MUTATION_FORBIDDEN", "Production mutation is forbidden.")
    if environment.get("enabled") is not True:
        raise PreflightError("ENVIRONMENT_DISABLED", "The staging environment is disabled.")
    if (
        not isinstance(execution, dict)
        or execution.get("liveApiEnabled") is not True
        or "LIVE_API" not in execution.get("allowedRunTypes", [])
        or execution.get("fixtureProfileRef") != "fixture.incident-payment"
    ):
        raise PreflightError(
            "LIVE_EXECUTION_POLICY_INCOMPLETE",
            "The staging environment live execution policy is incomplete.",
        )

    active = _get("/api/runs/live-active")
    active_items = active.get("items") if isinstance(active, dict) else None
    if isinstance(active_items, list) and active_items:
        raise PreflightError(
            "LIVE_RUN_REQUIRES_RECOVERY",
            "A live or recovery-required run already exists.",
        )

    query = urllib.parse.urlencode(
        {"scenarioId": SCENARIO_ID, "journey": "normal"}
    )
    readiness = _get(
        f"/api/environments/{args.environment_id}/execution-readiness?{query}"
    )
    if not isinstance(readiness, dict):
        raise PreflightError(
            "STATIC_READINESS_INVALID",
            "Static execution readiness returned an invalid document.",
        )
    if readiness.get("confirmed") is not False or readiness.get("mutationEligible") is not False:
        raise PreflightError(
            "STATIC_READINESS_UNSAFE",
            "Static readiness did not preserve its non-mutating posture.",
        )
    blocked = [
        check
        for check in readiness.get("checks", [])
        if isinstance(check, dict) and check.get("status") == "BLOCKED"
    ]
    blocked_codes = {str(check.get("code")) for check in blocked}
    if blocked_codes != {"NILES_MUTATIONS_DISABLED"}:
        raise PreflightError(
            "STATIC_READINESS_NOT_FIXTURE_READY",
            "Static readiness contains blockers other than the expected mutation switch.",
        )

    print("# NVS live acceptance preflight")
    print()
    print("- Deployed build identity: `PASS`")
    print("- Non-production live policy: `PASS`")
    print("- Fixture/static readiness: `PASS`")
    print("- Existing live/recovery runs: `NONE`")
    print("- Expected remaining gate: `NILES_MUTATIONS_DISABLED`")
    print()
    print("**Result:** PASS")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fail closed before opening the M1-02B staging mutation lease."
    )
    parser.add_argument("--environment-id", default="staging-example")
    parser.add_argument("--expected-sha", required=True)
    args = parser.parse_args()
    try:
        return _run(args)
    except PreflightError as error:
        print("# NVS live acceptance preflight")
        print()
        print("**Result:** BLOCKED")
        print()
        print(f"- Error code: `{error.code}`")
        print(f"- Error: {error}")
        return 2
    except Exception:
        print("# NVS live acceptance preflight")
        print()
        print("**Result:** FAIL")
        print()
        print("An unexpected local preflight error occurred; mutation was not enabled.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
