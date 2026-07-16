#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
DEPLOY_ROOT = Path("/opt/nvs")
CONFIG_ROOT = DEPLOY_ROOT / "config"
RUNTIME_GID = 10001


class ApplyError(RuntimeError):
    """A sanitized fixture-application failure."""


def _run(
    command: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout: int = 180,
) -> str:
    try:
        completed = subprocess.run(
            command,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        raise ApplyError(f"required local command failed to start: {command[0]}") from error
    if completed.returncode != 0:
        raise ApplyError(f"local command failed safely: {command[0]}")
    return completed.stdout.strip()


def _json_request(path: str, *, base_url: str = "http://127.0.0.1:4100") -> Any:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/{path.lstrip('/')}",
        headers={"accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
    except (urllib.error.URLError, TimeoutError) as error:
        raise ApplyError("the local NVS control plane is unavailable.") from error
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApplyError("the local NVS control plane returned invalid JSON.") from error


def _yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _yaml_bool(value: bool) -> str:
    return "true" if value else "false"


def _render_environment(environment: dict[str, Any]) -> str:
    required_strings = ["id", "displayName", "baseUrl", "kind", "healthPath"]
    for field in required_strings:
        if not isinstance(environment.get(field), str) or not environment[field]:
            raise ApplyError(f"loaded environment is missing required field {field}.")
    if environment["kind"] == "production":
        raise ApplyError("fixture application is forbidden for production environments.")
    capabilities = environment.get("capabilities")
    if not isinstance(capabilities, dict):
        raise ApplyError("loaded environment capabilities are invalid.")

    lines = [
        "schemaVersion: nvs.environment/v1",
        f"id: {environment['id']}",
        f"displayName: {_yaml_string(environment['displayName'])}",
        f"baseUrl: {_yaml_string(environment['baseUrl'])}",
        f"kind: {environment['kind']}",
        f"healthPath: {_yaml_string(environment['healthPath'])}",
    ]
    for field in ("readinessPath", "openApiPath", "versionPath"):
        value = environment.get(field)
        if isinstance(value, str) and value:
            lines.append(f"{field}: {_yaml_string(value)}")
    lines.extend(
        [
            "capabilities:",
            f"  health: {_yaml_bool(capabilities.get('health') is True)}",
            f"  readiness: {_yaml_bool(capabilities.get('readiness') is True)}",
            f"  openApi: {_yaml_bool(capabilities.get('openApi') is True)}",
            f"  version: {_yaml_bool(capabilities.get('version') is True)}",
        ]
    )
    auth_profile = environment.get("authProfileRef")
    if isinstance(auth_profile, str) and auth_profile:
        lines.append(f"authProfileRef: {auth_profile}")
    lines.extend(
        [
            "execution:",
            "  schemaVersion: nvs.environment-execution-policy/v1",
            "  liveApiEnabled: true",
            "  allowedRunTypes: [COMPILE_ONLY, LIVE_API]",
            "  fixtureProfileRef: fixture.incident-payment",
            "  liveRunAllowlist:",
            "    - scenarioId: payment-api-service-degradation",
            "      variationValues:",
            "        journey: normal",
            "enabled: true",
            "",
        ]
    )
    return "\n".join(lines)


def _selected(proposal: dict[str, Any], key: str) -> dict[str, Any]:
    selected = proposal.get("selected")
    item = selected.get(key) if isinstance(selected, dict) else None
    if not isinstance(item, dict):
        raise ApplyError(f"fixture proposal is missing selected {key}.")
    identifier = item.get("id")
    label = item.get("label")
    if not isinstance(identifier, str) or not UUID.fullmatch(identifier):
        raise ApplyError(f"fixture proposal {key} UUID is invalid.")
    if not isinstance(label, str) or not label.strip() or len(label) > 240:
        raise ApplyError(f"fixture proposal {key} label is invalid.")
    return item


def _selected_assignment_group(proposal: dict[str, Any]) -> dict[str, Any]:
    selected = proposal.get("selected")
    item = selected.get("assignmentGroup") if isinstance(selected, dict) else None
    if not isinstance(item, dict):
        raise ApplyError("fixture proposal is missing selected assignmentGroup.")
    mode = item.get("mode")
    label = item.get("label")
    if not isinstance(label, str) or not label.strip() or len(label) > 160:
        raise ApplyError("fixture proposal assignmentGroup label is invalid.")
    if mode == "LEGACY_LABEL":
        if len(label) > 100 or "id" in item:
            raise ApplyError("legacy assignmentGroup proposal is invalid.")
        return item
    if mode != "CANONICAL_ID":
        raise ApplyError("fixture proposal assignmentGroup mode is invalid.")
    identifier = item.get("id")
    if not isinstance(identifier, str) or not UUID.fullmatch(identifier):
        raise ApplyError("fixture proposal assignmentGroup UUID is invalid.")
    return item


def _render_fixture(proposal: dict[str, Any]) -> str:
    tenant_id = proposal.get("tenantId")
    if not isinstance(tenant_id, str) or not UUID.fullmatch(tenant_id):
        raise ApplyError("fixture proposal tenant UUID is invalid.")
    group = _selected_assignment_group(proposal)
    service = _selected(proposal, "service")
    offering = _selected(proposal, "offering")
    ci = _selected(proposal, "configurationItem")
    if offering.get("serviceId") != service["id"]:
        raise ApplyError("fixture proposal offering is not linked to the selected service.")

    reviewed_at = datetime.now(timezone.utc).isoformat()
    return "\n".join(
        [
            "schemaVersion: nvs.niles-incident-fixture/v1",
            "id: fixture.incident-payment",
            f"environmentId: {proposal['environmentId']}",
            "enabled: true",
            f"tenantId: {tenant_id}",
            "runNamespacePrefix: nvs-m1-02b",
            "scenarioAllowlist:",
            "  - scenarioId: payment-api-service-degradation",
            "    variationValues:",
            "      journey: normal",
            "resources:",
            "  assignmentGroup:",
            f"    mode: {group['mode']}",
            *(
                [f"    id: {group['id']}"]
                if group["mode"] == "CANONICAL_ID"
                else []
            ),
            f"    label: {_yaml_string(group['label'])}",
            "  service:",
            f"    id: {service['id']}",
            f"    label: {_yaml_string(service['label'])}",
            "  offering:",
            f"    id: {offering['id']}",
            f"    label: {_yaml_string(offering['label'])}",
            "  configurationItem:",
            f"    id: {ci['id']}",
            f"    label: {_yaml_string(ci['label'])}",
            "  affectedCi:",
            "    relationshipType: affected_by",
            "    impactScope: service_impacting",
            "  impact: high",
            "  urgency: high",
            "  expectedPriority: p1",
            "  hold:",
            "    pendingReason: pending_external_dependency",
            "    pendingReasonDetail: Waiting for payment provider diagnostics.",
            "  resolutionNotes: Synthetic provider remediation restored payment authorization successfully.",
            "  closeAuthority:",
            "    strategy: BLOCK_IF_UNSATISFIABLE",
            "    requesterMustHaveIncidentWrite: false",
            "  sla:",
            "    required: true",
            "    policyRef: fixture.payment-api-sla",
            "    objectiveTypes: [response, resolution]",
            "cleanup:",
            "  onPass: RETAIN_CLOSED",
            "  onFail: RETAIN_FOR_DIAGNOSIS",
            "  onBlockedBeforeClose: DELETE_IF_RUN_OWNED",
            "provenance:",
            "  source: Server-owned proposal produced by the reviewed staging fixture workflow.",
            "  grcCommit: 33af470e10fa753b79e092d9a99ef4f570854b10",
            f"  reviewedAt: {_yaml_string(reviewed_at)}",
            "",
        ]
    )


def _load_proposal(path: Path, expected_digest: str, environment_id: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ApplyError("the server-side fixture proposal is unavailable.")
    try:
        proposal = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ApplyError("the server-side fixture proposal is invalid.") from error
    if not isinstance(proposal, dict):
        raise ApplyError("the server-side fixture proposal has an unexpected shape.")
    digest = proposal.pop("digest", None)
    canonical = json.dumps(proposal, sort_keys=True, separators=(",", ":")).encode("utf-8")
    observed_digest = hashlib.sha256(canonical).hexdigest()
    proposal["digest"] = digest
    if digest != observed_digest or digest != expected_digest:
        raise ApplyError("proposal digest verification failed.")
    if proposal.get("schemaVersion") != "nvs.staging-fixture-proposal/v1":
        raise ApplyError("proposal schema version is unsupported.")
    if proposal.get("environmentId") != environment_id:
        raise ApplyError("proposal environment does not match the requested environment.")
    generated_at = proposal.get("generatedAt")
    try:
        generated = datetime.fromisoformat(generated_at)
    except (TypeError, ValueError) as error:
        raise ApplyError("proposal generation timestamp is invalid.") from error
    now = datetime.now(timezone.utc)
    if generated.tzinfo is None or generated > now + timedelta(minutes=5):
        raise ApplyError("proposal generation timestamp is outside the accepted clock window.")
    if now - generated > timedelta(hours=24):
        raise ApplyError("proposal is older than the 24-hour application window.")
    return proposal


def _atomic_replace(path: Path, content: str) -> None:
    if path.is_symlink():
        raise ApplyError(f"refusing to replace symbolic link {path}.")
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_stat = path.stat() if path.exists() else None
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=True) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o640)
        if existing_stat:
            try:
                os.chown(temporary, existing_stat.st_uid, existing_stat.st_gid)
            except PermissionError:
                pass
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _runtime_metadata() -> tuple[str, str, str, str]:
    image_ref = _run(["docker", "inspect", "--format", "{{.Config.Image}}", "nvs"])
    image_id = _run(["docker", "inspect", "--format", "{{.Image}}", "nvs"])
    build_sha = _run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}",
            image_id,
        ]
    )
    build_timestamp = _run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.created\" }}",
            image_id,
        ]
    )
    release_version = _run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.version\" }}",
            image_id,
        ]
    )
    if not FULL_SHA.fullmatch(build_sha):
        raise ApplyError("running NVS image does not expose a valid build SHA.")
    return image_ref, build_sha, build_timestamp, release_version


def _normalize_config(image_ref: str, paths: list[Path]) -> None:
    deploy_uid = os.getuid()
    relative_files = " ".join(f"'/config/{path.relative_to(CONFIG_ROOT)}'" for path in paths)
    relative_dirs = sorted({path.parent.relative_to(CONFIG_ROOT) for path in paths})
    directory_args = " ".join(f"'/config/{directory}'" for directory in relative_dirs)
    _run(
        [
            "docker",
            "run",
            "--rm",
            "--user",
            "0:0",
            "--entrypoint",
            "/bin/sh",
            "-v",
            f"{CONFIG_ROOT}:/config:rw",
            image_ref,
            "-c",
            (
                f"chown {deploy_uid}:{RUNTIME_GID} {directory_args} {relative_files} && "
                f"chmod 0750 {directory_args} && chmod 0640 {relative_files}"
            ),
        ]
    )


def _recreate(image_ref: str, build_sha: str, build_timestamp: str, release_version: str) -> None:
    environment = dict(os.environ)
    environment.update(
        {
            "NVS_IMAGE": image_ref,
            "NVS_BUILD_SHA": build_sha,
            "NVS_BUILD_TIMESTAMP": build_timestamp,
            "NVS_RELEASE_VERSION": release_version,
        }
    )
    compose = [
        "docker",
        "compose",
        "--project-directory",
        str(DEPLOY_ROOT),
        "-f",
        str(DEPLOY_ROOT / "docker-compose.staging.yml"),
    ]
    _run([*compose, "config", "--quiet"], env=environment)
    _run([*compose, "up", "-d", "--no-deps", "--force-recreate", "nvs"], env=environment)
    _run(
        [
            str(DEPLOY_ROOT / "ops" / "verify-deployment.sh"),
            "http://127.0.0.1:4100",
            build_sha,
            "120",
        ],
        timeout=150,
    )


def _run_apply(args: argparse.Namespace) -> int:
    if os.environ.get("NVS_FIXTURE_APPLY_GUARDED") != "1":
        raise ApplyError("direct fixture application is forbidden; use the reviewed guard workflow.")
    if not SAFE_ID.fullmatch(args.environment_id):
        raise ApplyError("environment_id is not a safe NVS identifier.")
    if not DIGEST.fullmatch(args.proposal_digest):
        raise ApplyError("proposal_digest must be a lowercase SHA-256 digest.")
    if args.confirmation != "APPLY_M1_02B_FIXTURE":
        raise ApplyError("explicit fixture application confirmation is required.")

    proposal = _load_proposal(Path(args.proposal_file), args.proposal_digest, args.environment_id)
    environments = _json_request("/api/environments")
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
        raise ApplyError("the requested environment is not loaded by NVS.")

    image_ref, build_sha, build_timestamp, release_version = _runtime_metadata()
    environment_path = CONFIG_ROOT / "environments" / "staging.yaml"
    fixture_path = CONFIG_ROOT / "fixtures" / "niles-incident" / "staging.yaml"

    _atomic_replace(environment_path, _render_environment(environment))
    _atomic_replace(fixture_path, _render_fixture(proposal))
    _normalize_config(image_ref, [environment_path, fixture_path])

    validation_environment = dict(os.environ)
    validation_environment["NVS_VALIDATE_IMAGE"] = image_ref
    _run(
        [
            str(DEPLOY_ROOT / "ops" / "validate-staging-config.sh"),
            str(CONFIG_ROOT),
            str(DEPLOY_ROOT / "data"),
        ],
        env=validation_environment,
        timeout=120,
    )
    _recreate(image_ref, build_sha, build_timestamp, release_version)

    readiness = _json_request(
        "/api/environments/"
        + args.environment_id
        + "/execution-readiness?scenarioId=payment-api-service-degradation&journey=normal"
    )
    blocked = (
        [
            check
            for check in readiness.get("checks", [])
            if isinstance(check, dict) and check.get("status") == "BLOCKED"
        ]
        if isinstance(readiness, dict)
        else []
    )

    print("# NVS staging fixture application")
    print()
    print("The reviewed proposal was applied and NVS was reloaded with mutation still disabled.")
    print()
    print(f"- Environment: `{args.environment_id}`")
    print(f"- Proposal digest: `{args.proposal_digest}`")
    print(f"- Running build SHA: `{build_sha}`")
    print("- Local config validation: `PASS`")
    print("- NVS reload verification: `PASS`")
    print(
        f"- Static readiness verdict: `{readiness.get('verdict') if isinstance(readiness, dict) else 'UNKNOWN'}`"
    )
    print(f"- Remaining blocked gates: `{len(blocked)}`")
    for check in blocked:
        print(f"  - `{check.get('id')}`: `{check.get('code') or 'NO_CODE'}`")
    print()
    print("**Result:** PASS")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply a reviewed M1-02B fixture proposal without enabling NILES mutations."
    )
    parser.add_argument("--environment-id", default="staging-example")
    parser.add_argument("--proposal-digest", required=True)
    parser.add_argument("--confirmation", required=True)
    parser.add_argument(
        "--proposal-file",
        default="/opt/nvs/releases/nvs-fixture-proposal-latest.json",
    )
    args = parser.parse_args()
    try:
        return _run_apply(args)
    except ApplyError as error:
        print("# NVS staging fixture application")
        print()
        print("**Result:** BLOCKED")
        print()
        print(str(error))
        return 2
    except Exception:
        print("# NVS staging fixture application")
        print()
        print("**Result:** FAIL")
        print()
        print("An unexpected local application error occurred; outer rollback is required.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
