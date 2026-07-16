#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
ALLOWED_ROOT = Path("/opt/nvs/releases")
INACTIVE_VALUES = {"inactive", "retired", "decommissioned", "disabled", "deleted"}
GROUP_PHRASE_WEIGHTS = {
    "service desk": 140,
    "help desk": 130,
    "it support": 120,
    "technical support": 110,
    "application support": 100,
    "service operations": 90,
}
GROUP_TOKEN_WEIGHTS = {
    "support": 80,
    "desk": 70,
    "help": 60,
    "service": 50,
    "incident": 45,
    "operations": 40,
    "ops": 40,
    "technical": 35,
    "application": 30,
    "platform": 25,
    "it": 20,
}


class PlanError(RuntimeError):
    """A sanitized proposal-planning failure."""


def _validate_text(value: str, label: str, *, maximum: int = 100) -> str:
    normalized = value.strip()
    if not normalized:
        raise PlanError(f"{label} must not be empty.")
    if len(normalized) > maximum or any(ord(character) < 32 for character in normalized):
        raise PlanError(f"{label} must be at most {maximum} printable characters.")
    return normalized


def _atomic_write(path: Path, payload: bytes) -> None:
    if not path.is_absolute() or path.parent.resolve() != ALLOWED_ROOT:
        raise PlanError("proposal files must remain under /opt/nvs/releases.")
    if path.is_symlink():
        raise PlanError("refusing to replace a symbolic-link proposal file.")
    path.parent.mkdir(parents=False, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def _safe_discovery_error(stderr: str, return_code: int) -> str:
    for line in reversed(stderr.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            error = payload["error"]
            code = error.get("code")
            message = error.get("message")
            if isinstance(code, str) and isinstance(message, str):
                return f"{code}: {message}"
    return f"fixture discovery failed inside the NVS container (exit {return_code})"


def _invoke_discovery(args: argparse.Namespace, assignment_group_query: str) -> dict[str, Any]:
    discovery_script = Path(args.discovery_script)
    if not discovery_script.is_file():
        raise PlanError("the container discovery script was not found.")

    command = [
        "docker",
        "exec",
        "-i",
        "-e",
        f"NVS_DISCOVERY_ENVIRONMENT_ID={args.environment_id}",
        "-e",
        f"NVS_DISCOVERY_GROUP_QUERY={assignment_group_query}",
        "-e",
        f"NVS_DISCOVERY_SERVICE_QUERY={args.service_query}",
        "-e",
        f"NVS_DISCOVERY_OFFERING_QUERY={args.offering_query}",
        "-e",
        f"NVS_DISCOVERY_CI_QUERY={args.ci_query}",
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
        raise PlanError("docker is not available to the staging deploy user.") from error
    except subprocess.TimeoutExpired as error:
        raise PlanError("fixture proposal discovery exceeded its 90-second deadline.") from error

    stderr = completed.stderr.decode("utf-8", errors="replace").strip()
    if completed.returncode != 0:
        raise PlanError(_safe_discovery_error(stderr, completed.returncode))
    try:
        discovery = json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PlanError("fixture discovery returned invalid sanitized JSON.") from error
    if not isinstance(discovery, dict):
        raise PlanError("fixture discovery returned an unexpected result shape.")
    errors = discovery.get("errors")
    if isinstance(errors, list) and errors:
        scopes = sorted(
            str(item.get("scope"))
            for item in errors
            if isinstance(item, dict) and item.get("scope")
        )
        raise PlanError(
            "fixture discovery was incomplete for: " + ", ".join(scopes or ["unknown scope"])
        )
    return discovery


def _run_discovery(args: argparse.Namespace) -> dict[str, Any]:
    discovery = _invoke_discovery(args, args.assignment_group_query)
    candidates = discovery.get("candidates")
    candidate_map = candidates if isinstance(candidates, dict) else {}
    groups = candidate_map.get("assignmentGroups")
    if isinstance(groups, list) and groups:
        return discovery

    fallback = _invoke_discovery(args, "")
    fallback_candidates = fallback.get("candidates")
    fallback_map = fallback_candidates if isinstance(fallback_candidates, dict) else {}
    fallback_groups = fallback_map.get("assignmentGroups")
    candidate_map["assignmentGroups"] = fallback_groups if isinstance(fallback_groups, list) else []
    discovery["candidates"] = candidate_map
    discovery["fallbacks"] = {"assignmentGroup": "UNFILTERED_CANONICAL_RANKING"}
    return discovery


def _name_matches(item: dict[str, Any], query: str) -> bool:
    name = item.get("name")
    if not isinstance(name, str):
        return False
    tokens = [token for token in query.casefold().split() if token]
    haystack = name.casefold()
    return bool(tokens) and all(token in haystack for token in tokens)


def _active(item: dict[str, Any]) -> bool:
    if item.get("isActive") is False:
        return False
    for key in ("status", "lifecycle"):
        value = item.get(key)
        if isinstance(value, str) and value.casefold() in INACTIVE_VALUES:
            return False
    return True


def _words(value: Any) -> set[str]:
    if not isinstance(value, str):
        return set()
    return set(re.findall(r"[a-z0-9]+", value.casefold()))


def _normalized_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _assignment_group_score(item: dict[str, Any]) -> int:
    name = _normalized_text(item.get("name"))
    description = _normalized_text(item.get("description"))
    name_words = _words(item.get("name"))
    description_words = _words(item.get("description"))
    score = 0
    for phrase, weight in GROUP_PHRASE_WEIGHTS.items():
        if phrase in name:
            score += weight
        elif phrase in description:
            score += max(1, weight // 2)
    for token, weight in GROUP_TOKEN_WEIGHTS.items():
        if token in name_words:
            score += weight
        elif token in description_words:
            score += max(1, weight // 2)
    return score


def _validate_uuid(scope: str, selected: dict[str, Any]) -> None:
    identifier = selected.get("id")
    if not isinstance(identifier, str) or not UUID.fullmatch(identifier):
        raise PlanError(f"{scope} selection did not expose a valid UUID.")


def _choose_assignment_group(values: Any, query: str) -> tuple[dict[str, Any], int, str]:
    candidates = [item for item in values if isinstance(item, dict)] if isinstance(values, list) else []
    active = [item for item in candidates if _active(item)]
    exact = [item for item in active if _name_matches(item, query)]
    if len(exact) == 1:
        _validate_uuid("assignment group", exact[0])
        return exact[0], len(candidates), "EXACT_QUERY"
    if len(exact) > 1:
        raise PlanError(
            f"assignment group selector matched {len(exact)} eligible records; refine the browser workflow query until exactly one remains."
        )
    if len(active) == 1:
        _validate_uuid("assignment group", active[0])
        return active[0], len(candidates), "SOLE_ACTIVE_FALLBACK"

    scored = [(_assignment_group_score(item), item) for item in active]
    best_score = max((score for score, _item in scored), default=0)
    best = [item for score, item in scored if score == best_score and score > 0]
    if len(best) != 1:
        raise PlanError(
            "assignment group selector matched 0 eligible records and canonical fallback "
            f"could not choose uniquely from {len(active)} active groups; refine the browser workflow query."
        )
    _validate_uuid("assignment group", best[0])
    return best[0], len(candidates), "CANONICAL_RANK_FALLBACK"


def _choose_unique(
    scope: str,
    values: Any,
    query: str,
    predicate: Callable[[dict[str, Any]], bool] | None = None,
) -> tuple[dict[str, Any], int]:
    candidates = [item for item in values if isinstance(item, dict)] if isinstance(values, list) else []
    eligible = [
        item
        for item in candidates
        if _active(item)
        and _name_matches(item, query)
        and (predicate(item) if predicate else True)
    ]
    if len(eligible) != 1:
        raise PlanError(
            f"{scope} selector matched {len(eligible)} eligible records; refine the browser workflow query until exactly one remains."
        )
    selected = eligible[0]
    _validate_uuid(scope, selected)
    return selected, len(candidates)


def _selection(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "label": item.get("name") or "Selected staging record",
        **(
            {"serviceId": item["serviceId"]}
            if isinstance(item.get("serviceId"), str)
            else {}
        ),
        **(
            {"defaultSlaProfileId": item["defaultSlaProfileId"]}
            if isinstance(item.get("defaultSlaProfileId"), str)
            else {}
        ),
    }


def _run(args: argparse.Namespace) -> int:
    if not SAFE_ID.fullmatch(args.environment_id):
        raise PlanError("environment_id is not a safe NVS identifier.")
    for field in (
        "assignment_group_query",
        "service_query",
        "offering_query",
        "ci_query",
    ):
        setattr(args, field, _validate_text(getattr(args, field), field.replace("_", " ")))

    discovery = _run_discovery(args)
    if discovery.get("environmentId") != args.environment_id:
        raise PlanError("fixture discovery returned an unexpected environment.")
    tenant_id = discovery.get("tenantId")
    if not isinstance(tenant_id, str) or not UUID.fullmatch(tenant_id):
        raise PlanError("fixture discovery did not return a valid tenant UUID.")

    candidates = discovery.get("candidates")
    candidate_map = candidates if isinstance(candidates, dict) else {}
    group, group_count, group_mode = _choose_assignment_group(
        candidate_map.get("assignmentGroups"), args.assignment_group_query
    )
    service, service_count = _choose_unique(
        "CMDB service", candidate_map.get("services"), args.service_query
    )
    offering, offering_count = _choose_unique(
        "service offering",
        candidate_map.get("offerings"),
        args.offering_query,
        lambda item: item.get("serviceId") == service["id"],
    )
    ci, ci_count = _choose_unique(
        "configuration item", candidate_map.get("configurationItems"), args.ci_query
    )

    choices = discovery.get("choices")
    choice_map = choices if isinstance(choices, dict) else {}
    required_choices = {
        "pendingReason": "pending_external_dependency",
        "relationshipType": "affected_by",
        "impactScope": "service_impacting",
    }
    for field, expected in required_choices.items():
        values = choice_map.get(field)
        if not isinstance(values, list) or expected not in values:
            raise PlanError(
                f"tenant choice catalog does not contain required {field} value {expected}."
            )

    generated_at = datetime.now(timezone.utc).isoformat()
    proposal: dict[str, Any] = {
        "schemaVersion": "nvs.staging-fixture-proposal/v1",
        "environmentId": args.environment_id,
        "tenantId": tenant_id,
        "generatedAt": generated_at,
        "selectors": {
            "assignmentGroup": args.assignment_group_query,
            "service": args.service_query,
            "offering": args.offering_query,
            "configurationItem": args.ci_query,
        },
        "selectionModes": {
            "assignmentGroup": group_mode,
            "service": "EXACT_QUERY",
            "offering": "EXACT_QUERY_AND_SERVICE_LINK",
            "configurationItem": "EXACT_QUERY",
        },
        "selected": {
            "assignmentGroup": _selection(group),
            "service": _selection(service),
            "offering": _selection(offering),
            "configurationItem": _selection(ci),
        },
        "choices": required_choices,
        "candidateCounts": {
            "assignmentGroups": group_count,
            "services": service_count,
            "offerings": offering_count,
            "configurationItems": ci_count,
        },
    }
    canonical = json.dumps(proposal, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    proposal["digest"] = digest

    proposal_path = Path(args.output_file)
    discovery_path = Path(args.discovery_output_file)
    _atomic_write(
        discovery_path,
        (json.dumps(discovery, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )
    _atomic_write(
        proposal_path,
        (json.dumps(proposal, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )

    print("# NVS staging fixture proposal")
    print()
    print("A unique server-side proposal was produced without exposing staging UUIDs or labels.")
    print()
    print(f"- Environment: `{args.environment_id}`")
    print(f"- Proposal digest: `{digest}`")
    print(f"- Assignment-group selection mode: `{group_mode}`")
    print(f"- Assignment-group eligible selection: `1` of `{group_count}` returned")
    print(f"- Service eligible matches: `1` of `{service_count}` returned")
    print(
        f"- Offering eligible matches linked to the selected service: `1` of `{offering_count}` returned"
    )
    print(f"- CI eligible matches: `1` of `{ci_count}` returned")
    print(f"- Server proposal file: `{proposal_path}`")
    print()
    print("**Result:** PASS")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a unique, non-secret M1-02B fixture proposal on staging."
    )
    parser.add_argument("--environment-id", default="staging-example")
    parser.add_argument("--assignment-group-query", default="service desk")
    parser.add_argument("--service-query", default="payment")
    parser.add_argument("--offering-query", default="payment")
    parser.add_argument("--ci-query", default="payment")
    parser.add_argument("--discovery-script", required=True)
    parser.add_argument(
        "--discovery-output-file",
        default="/opt/nvs/releases/nvs-fixture-discovery-latest.json",
    )
    parser.add_argument(
        "--output-file",
        default="/opt/nvs/releases/nvs-fixture-proposal-latest.json",
    )
    args = parser.parse_args()
    try:
        return _run(args)
    except PlanError as error:
        print("# NVS staging fixture proposal")
        print()
        print("**Result:** BLOCKED")
        print()
        print(str(error))
        return 2
    except Exception:
        print("# NVS staging fixture proposal")
        print()
        print("**Result:** FAIL")
        print()
        print("An unexpected local planning error occurred; no secret values were emitted.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
