#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


class OperatorError(RuntimeError):
    """A sanitized operator-facing failure."""


@dataclass(frozen=True)
class HttpFailure:
    status: int
    code: str | None


def _json_request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    body: Mapping[str, Any] | None = None,
    timeout_seconds: float = 20.0,
) -> Any:
    url = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "accept": "application/json",
            **({"content-type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        code: str | None = None
        try:
            payload = json.loads(error.read().decode("utf-8", errors="replace"))
            if isinstance(payload, dict):
                error_payload = payload.get("error")
                if isinstance(error_payload, dict) and isinstance(error_payload.get("code"), str):
                    code = error_payload["code"]
        except Exception:
            code = None
        suffix = f" ({code})" if code else ""
        raise OperatorError(f"{method} {path} failed with HTTP {error.code}{suffix}.") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise OperatorError(f"{method} {path} could not reach the local NVS control plane.") from error

    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OperatorError(f"{method} {path} returned a non-JSON response.") from error


def _markdown_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _table(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> list[str]:
    materialized = [list(row) for row in rows]
    lines = [
        "| " + " | ".join(_markdown_escape(header) for header in headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    if not materialized:
        lines.append("| " + " | ".join("—" for _ in headers) + " |")
        return lines
    for row in materialized:
        lines.append("| " + " | ".join(_markdown_escape(value) for value in row) + " |")
    return lines


def _validate_common(environment_id: str) -> None:
    if not SAFE_ID.fullmatch(environment_id):
        raise OperatorError("environment_id is not a safe NVS identifier.")


def _verify(args: argparse.Namespace) -> int:
    _validate_common(args.environment_id)
    if args.expected_sha and not FULL_SHA.fullmatch(args.expected_sha):
        raise OperatorError("expected_sha must be empty or a full 40-character lowercase Git SHA.")

    version = _json_request(args.base_url, "/api/version")
    readiness = _json_request(args.base_url, "/api/health/ready")
    environments = _json_request(args.base_url, "/api/environments")
    actors_document = _json_request(
        args.base_url, f"/api/environments/{args.environment_id}/actors"
    )
    auth = _json_request(
        args.base_url,
        f"/api/environments/{args.environment_id}/auth-preflight",
        method="POST",
        body={},
        timeout_seconds=40.0,
    )
    execution = _json_request(
        args.base_url,
        (
            f"/api/environments/{args.environment_id}/execution-readiness"
            "?scenarioId=payment-api-service-degradation&journey=normal"
        ),
    )

    environment = next(
        (
            item
            for item in environments.get("items", [])
            if isinstance(item, dict) and item.get("id") == args.environment_id
        ),
        None,
    )
    actors = actors_document.get("actors", []) if isinstance(actors_document, dict) else []
    configured = [
        actor
        for actor in actors
        if isinstance(actor, dict) and actor.get("credentialConfiguration") == "CONFIGURED"
    ]
    auth_actors = auth.get("actors", []) if isinstance(auth, dict) else []
    authenticated = [
        actor
        for actor in auth_actors
        if isinstance(actor, dict) and actor.get("authenticationState") == "AUTHENTICATED"
    ]
    blocked_checks = [
        check
        for check in execution.get("checks", [])
        if isinstance(check, dict) and check.get("status") == "BLOCKED"
    ]

    observed_sha = version.get("buildSha") if isinstance(version, dict) else None
    failures: list[str] = []
    if args.expected_sha and observed_sha != args.expected_sha:
        failures.append("deployed build SHA does not match expected_sha")
    if not isinstance(readiness, dict) or readiness.get("status") != "ready":
        failures.append("local readiness is not ready")
    if environment is None:
        failures.append("requested environment is not loaded")
    if len(actors) != 5 or len(configured) != 5:
        failures.append("synthetic actor credentials are not CONFIGURED 5/5")
    if (
        not isinstance(auth, dict)
        or auth.get("verdict") != "PASS"
        or len(auth_actors) != 5
        or len(authenticated) != 5
    ):
        failures.append("authentication preflight is not PASS 5/5")
    if not isinstance(execution, dict) or execution.get("mutationEligible") is not False:
        failures.append("static readiness did not preserve mutationEligible=false")

    policy = environment.get("execution") if isinstance(environment, dict) else None
    lines = ["# NVS staging verification", ""]
    lines.extend(
        _table(
            ["Check", "Observed"],
            [
                ["Build SHA", observed_sha or "unavailable"],
                ["Local readiness", readiness.get("status") if isinstance(readiness, dict) else "invalid"],
                [
                    "Environment",
                    (
                        f"{args.environment_id}; enabled={environment.get('enabled')}; "
                        f"kind={environment.get('kind')}; "
                        f"liveApiEnabled={(policy or {}).get('liveApiEnabled')}"
                        if isinstance(environment, dict)
                        else "not found"
                    ),
                ],
                ["Actor credentials", f"CONFIGURED {len(configured)}/{len(actors)}"],
                [
                    "Authentication preflight",
                    f"{auth.get('verdict') if isinstance(auth, dict) else 'invalid'}; "
                    f"AUTHENTICATED {len(authenticated)}/{len(auth_actors)}",
                ],
                [
                    "Static live readiness",
                    (
                        f"verdict={execution.get('verdict')}; "
                        f"confirmed={execution.get('confirmed')}; "
                        f"mutationEligible={execution.get('mutationEligible')}"
                        if isinstance(execution, dict)
                        else "invalid"
                    ),
                ],
            ],
        )
    )

    lines.extend(["", "## Live gates that remain blocked", ""])
    if blocked_checks:
        lines.extend(
            _table(
                ["Gate", "Code", "Explanation"],
                [
                    [check.get("id"), check.get("code") or "NO_CODE", check.get("message")]
                    for check in blocked_checks
                ],
            )
        )
    else:
        lines.append("No blocked live gates were reported.")

    failed_actors = [
        actor
        for actor in auth_actors
        if isinstance(actor, dict) and actor.get("authenticationState") != "AUTHENTICATED"
    ]
    if failed_actors:
        lines.extend(["", "## Authentication failures", ""])
        lines.extend(
            _table(
                ["Actor", "State", "Code"],
                [
                    [
                        actor.get("actorProfileId"),
                        actor.get("authenticationState"),
                        (actor.get("error") or {}).get("code")
                        if isinstance(actor.get("error"), dict)
                        else None,
                    ]
                    for actor in failed_actors
                ],
            )
        )

    lines.extend(["", f"**Result:** {'FAIL' if failures else 'PASS'}"])
    if failures:
        lines.extend(["", "Failures:"])
        lines.extend(f"- {_markdown_escape(failure)}" for failure in failures)

    print("\n".join(lines))
    return 1 if failures else 0


def _safe_discovery_error(stderr: str, return_code: int) -> str:
    for line in reversed(stderr.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                code = error.get("code")
                message = error.get("message")
                if isinstance(code, str) and isinstance(message, str):
                    return f"{code}: {message}"
    return f"fixture discovery failed inside the NVS container (exit {return_code})"


def _discover(args: argparse.Namespace) -> int:
    _validate_common(args.environment_id)
    if len(args.query) > 100 or any(ord(character) < 32 for character in args.query):
        raise OperatorError("query must be at most 100 printable characters.")
    discovery_script = Path(args.discovery_script)
    if not discovery_script.is_file():
        raise OperatorError("the container discovery script was not found.")

    command = [
        "docker",
        "exec",
        "-i",
        "-e",
        f"NVS_DISCOVERY_ENVIRONMENT_ID={args.environment_id}",
        "-e",
        f"NVS_DISCOVERY_QUERY={args.query}",
        "nvs",
        "node",
        "--input-type=module",
        "-",
    ]
    try:
        with discovery_script.open("rb") as script_handle:
            completed = subprocess.run(
                command,
                stdin=script_handle,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=90,
                check=False,
            )
    except FileNotFoundError as error:
        raise OperatorError("docker is not available to the staging deploy user.") from error
    except subprocess.TimeoutExpired as error:
        raise OperatorError("fixture discovery exceeded its 90-second safety deadline.") from error

    stdout = completed.stdout.decode("utf-8", errors="replace").strip()
    stderr = completed.stderr.decode("utf-8", errors="replace").strip()
    if completed.returncode != 0:
        raise OperatorError(_safe_discovery_error(stderr, completed.returncode))

    try:
        discovery = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise OperatorError("fixture discovery returned an invalid sanitized result.") from error
    if not isinstance(discovery, dict):
        raise OperatorError("fixture discovery returned an unexpected result shape.")

    candidates = discovery.get("candidates") if isinstance(discovery.get("candidates"), dict) else {}
    choices = discovery.get("choices") if isinstance(discovery.get("choices"), dict) else {}
    errors = discovery.get("errors") if isinstance(discovery.get("errors"), list) else []

    lines = [
        "# NILES staging fixture discovery",
        "",
        f"- Environment: `{_markdown_escape(discovery.get('environmentId'))}`",
        f"- Tenant: `{_markdown_escape(discovery.get('tenantId'))}`",
        f"- Query: `{_markdown_escape(discovery.get('query') or '(none)')}`",
        "",
        "The tables contain only non-secret candidate identifiers and labels. No credential or bearer material is included.",
    ]

    sections = [
        (
            "Assignment groups",
            ["ID", "Name", "Active", "Description"],
            [
                [item.get("id"), item.get("name"), item.get("isActive"), item.get("description")]
                for item in candidates.get("assignmentGroups", [])
                if isinstance(item, dict)
            ],
        ),
        (
            "CMDB services",
            ["ID", "Name", "Status", "Type", "Tier", "Criticality"],
            [
                [
                    item.get("id"),
                    item.get("name"),
                    item.get("status"),
                    item.get("type"),
                    item.get("tier"),
                    item.get("criticality"),
                ]
                for item in candidates.get("services", [])
                if isinstance(item, dict)
            ],
        ),
        (
            "Service offerings",
            ["ID", "Service ID", "Name", "Status", "Support hours", "Default SLA profile"],
            [
                [
                    item.get("id"),
                    item.get("serviceId"),
                    item.get("name"),
                    item.get("status"),
                    item.get("supportHours"),
                    item.get("defaultSlaProfileId"),
                ]
                for item in candidates.get("offerings", [])
                if isinstance(item, dict)
            ],
        ),
        (
            "Configuration items",
            ["ID", "Name", "Class", "Lifecycle", "Environment"],
            [
                [
                    item.get("id"),
                    item.get("name"),
                    item.get("classLabel") or item.get("className"),
                    item.get("lifecycle"),
                    item.get("environment"),
                ]
                for item in candidates.get("configurationItems", [])
                if isinstance(item, dict)
            ],
        ),
    ]
    for title, headers, rows in sections:
        lines.extend(["", f"## {title}", ""])
        lines.extend(_table(headers, rows))

    lines.extend(["", "## Canonical tenant choices", ""])
    lines.extend(
        _table(
            ["Field", "Allowed values"],
            [
                ["Incident pending reason", ", ".join(choices.get("pendingReason", []))],
                ["Incident-CI relationship", ", ".join(choices.get("relationshipType", []))],
                ["Incident-CI impact scope", ", ".join(choices.get("impactScope", []))],
            ],
        )
    )

    if errors:
        lines.extend(["", "## Incomplete discovery scopes", ""])
        lines.extend(
            _table(
                ["Scope", "Code", "HTTP status"],
                [
                    [error.get("scope"), error.get("code"), error.get("httpStatus")]
                    for error in errors
                    if isinstance(error, dict)
                ],
            )
        )

    lines.extend(["", f"**Result:** {'PARTIAL' if errors else 'PASS'}"])
    print("\n".join(lines))
    return 2 if errors else 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run sanitized, non-mutating NVS staging operator checks."
    )
    subparsers = parser.add_subparsers(dest="operation", required=True)

    verify = subparsers.add_parser("verify", help="verify deployed NVS and M1-02A authentication")
    verify.add_argument("--base-url", default="http://127.0.0.1:4100")
    verify.add_argument("--environment-id", default="staging-example")
    verify.add_argument("--expected-sha", default="")
    verify.set_defaults(handler=_verify)

    discover = subparsers.add_parser(
        "discover", help="list safe candidate records for the M1-02B server-owned fixture"
    )
    discover.add_argument("--environment-id", default="staging-example")
    discover.add_argument("--query", default="")
    discover.add_argument("--discovery-script", required=True)
    discover.set_defaults(handler=_discover)

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        return int(args.handler(args))
    except OperatorError as error:
        print(f"# NVS staging operator\n\n**Result:** FAIL\n\n{_markdown_escape(error)}")
        return 1
    except Exception:
        print(
            "# NVS staging operator\n\n"
            "**Result:** FAIL\n\n"
            "An unexpected local operator error occurred; no secret values were emitted."
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
