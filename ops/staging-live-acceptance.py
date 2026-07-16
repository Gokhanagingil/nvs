#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
DEPLOY_ROOT = Path("/opt/nvs")
RELEASE_ROOT = DEPLOY_ROOT / "releases"
ENV_FILE = DEPLOY_ROOT / ".env"
ACTIVE_LEASE = RELEASE_ROOT / ".nvs-mutation-lease-active.json"
CLEANUP_LOCK = RELEASE_ROOT / ".nvs-mutation-cleanup.lock"
BASE_URL = "http://127.0.0.1:4100"
SCENARIO_ID = "payment-api-service-degradation"
VARIATION_VALUES = {"journey": "normal"}
LEASE_TTL_SECONDS = 15 * 60
RUN_TIMEOUT_SECONDS = 10 * 60
POLL_INTERVAL_SECONDS = 2.0


class AcceptanceError(RuntimeError):
    def __init__(self, code: str, message: str, *, result: str = "FAIL") -> None:
        super().__init__(message)
        self.code = code
        self.result = result


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _run_command(
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
        raise AcceptanceError(
            "LOCAL_COMMAND_UNAVAILABLE",
            f"Required local command could not complete: {command[0]}.",
        ) from error
    if completed.returncode != 0:
        raise AcceptanceError(
            "LOCAL_COMMAND_FAILED",
            f"Required local command failed safely: {command[0]}.",
        )
    return completed.stdout.strip()


def _read_json_response(response: Any, scope: str) -> Any:
    raw = response.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AcceptanceError(
            "NVS_RESPONSE_MALFORMED",
            f"{scope} returned invalid JSON.",
        ) from error


def _json_request(
    path: str,
    *,
    method: str = "GET",
    body: Mapping[str, Any] | None = None,
    timeout: float = 30.0,
    allow_statuses: set[int] | None = None,
) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}/{path.lstrip('/')}",
        data=data,
        method=method,
        headers={
            "accept": "application/json",
            **({"content-type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, _read_json_response(response, f"{method} {path}")
    except urllib.error.HTTPError as error:
        payload: Any = None
        try:
            payload = _read_json_response(error, f"{method} {path}")
        except AcceptanceError:
            payload = None
        if allow_statuses and error.code in allow_statuses:
            return error.code, payload
        code = None
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            candidate = payload["error"].get("code")
            code = candidate if isinstance(candidate, str) else None
        raise AcceptanceError(
            code or "NVS_HTTP_FAILURE",
            f"{method} {path} returned HTTP {error.code}.",
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise AcceptanceError(
            "NVS_CONTROL_PLANE_UNREACHABLE",
            f"{method} {path} could not reach the local NVS control plane.",
        ) from error


def _safe_atomic_write(path: Path, payload: bytes, *, mode: int, uid: int, gid: int) -> None:
    if path.is_symlink():
        raise AcceptanceError("UNSAFE_SYMBOLIC_LINK", f"Refusing symbolic-link path: {path}.")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.chown(temporary, uid, gid)
        except PermissionError:
            pass
        os.replace(temporary, path)
        os.chmod(path, mode)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _read_env() -> tuple[bytes, os.stat_result]:
    if ENV_FILE.is_symlink() or not ENV_FILE.is_file():
        raise AcceptanceError(
            "ENV_FILE_UNSAFE",
            "The server-owned NVS .env file is unavailable or unsafe.",
        )
    try:
        return ENV_FILE.read_bytes(), ENV_FILE.stat()
    except OSError as error:
        raise AcceptanceError("ENV_FILE_UNREADABLE", "The NVS .env file could not be read.") from error


def _switch_value(raw: bytes) -> str:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise AcceptanceError("ENV_FILE_INVALID", "The NVS .env file is not UTF-8.") from error
    observed = "false"
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "NVS_ENABLE_NILES_MUTATIONS":
            observed = value.strip().strip("'\"").casefold()
    return observed


def _rewrite_switch(enabled: bool) -> None:
    raw, stat = _read_env()
    text = raw.decode("utf-8")
    replacement = f"NVS_ENABLE_NILES_MUTATIONS={'true' if enabled else 'false'}"
    lines = text.splitlines()
    updated: list[str] = []
    replaced = False
    for line in lines:
        if re.match(r"^\s*NVS_ENABLE_NILES_MUTATIONS\s*=", line):
            if not replaced:
                updated.append(replacement)
                replaced = True
            continue
        updated.append(line)
    if not replaced:
        updated.append(replacement)
    payload = ("\n".join(updated) + "\n").encode("utf-8")
    _safe_atomic_write(
        ENV_FILE,
        payload,
        mode=0o600,
        uid=stat.st_uid,
        gid=stat.st_gid,
    )


def _runtime_metadata() -> dict[str, str]:
    image_ref = _run_command(["docker", "inspect", "--format", "{{.Config.Image}}", "nvs"])
    image_id = _run_command(["docker", "inspect", "--format", "{{.Image}}", "nvs"])
    build_sha = _run_command(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}",
            image_id,
        ]
    )
    build_timestamp = _run_command(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.created\" }}",
            image_id,
        ]
    )
    release_version = _run_command(
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
        raise AcceptanceError(
            "RUNNING_BUILD_INVALID",
            "The running NVS image does not expose a valid build SHA.",
        )
    return {
        "imageRef": image_ref,
        "buildSha": build_sha,
        "buildTimestamp": build_timestamp,
        "releaseVersion": release_version,
    }


def _recreate(metadata: Mapping[str, str]) -> None:
    environment = dict(os.environ)
    environment.update(
        {
            "NVS_IMAGE": metadata["imageRef"],
            "NVS_BUILD_SHA": metadata["buildSha"],
            "NVS_BUILD_TIMESTAMP": metadata["buildTimestamp"],
            "NVS_RELEASE_VERSION": metadata["releaseVersion"],
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
    _run_command([*compose, "config", "--quiet"], env=environment)
    _run_command(
        [*compose, "up", "-d", "--no-deps", "--force-recreate", "nvs"],
        env=environment,
    )
    _run_command(
        [
            str(DEPLOY_ROOT / "ops" / "verify-deployment.sh"),
            BASE_URL,
            metadata["buildSha"],
            "120",
        ],
        timeout=150,
    )


def _lease_payload(lease_id: str, backup_path: Path, metadata: Mapping[str, str]) -> dict[str, Any]:
    now = _utc_now()
    return {
        "schemaVersion": "nvs.mutation-lease/v1",
        "leaseId": lease_id,
        "createdAt": _iso(now),
        "expiresAt": _iso(now + timedelta(seconds=LEASE_TTL_SECONDS)),
        "backupPath": str(backup_path),
        "watchdogPath": str(RELEASE_ROOT / f".nvs-live-watchdog-{lease_id}.py"),
        "watchdogPidPath": str(RELEASE_ROOT / f".nvs-live-watchdog-{lease_id}.pid"),
        "runtime": dict(metadata),
    }


def _create_lease(lease_id: str, metadata: Mapping[str, str]) -> dict[str, Any]:
    if ACTIVE_LEASE.is_symlink() or ACTIVE_LEASE.exists():
        raise AcceptanceError(
            "MUTATION_LEASE_ALREADY_ACTIVE",
            "A staging mutation lease already exists and requires operator recovery.",
            result="BLOCKED",
        )
    raw, stat = _read_env()
    backup_path = RELEASE_ROOT / f"nvs-env-before-live-{lease_id}.backup"
    if backup_path.exists() or backup_path.is_symlink():
        raise AcceptanceError("MUTATION_BACKUP_COLLISION", "The mutation backup path already exists.")
    _safe_atomic_write(
        backup_path,
        raw,
        mode=0o600,
        uid=stat.st_uid,
        gid=stat.st_gid,
    )
    lease = _lease_payload(lease_id, backup_path, metadata)
    payload = (json.dumps(lease, indent=2, sort_keys=True) + "\n").encode("utf-8")
    try:
        descriptor = os.open(ACTIVE_LEASE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            backup_path.unlink()
        except FileNotFoundError:
            pass
        raise
    os.chmod(ACTIVE_LEASE, 0o600)
    return lease


def _read_lease() -> dict[str, Any] | None:
    if not ACTIVE_LEASE.exists():
        return None
    if ACTIVE_LEASE.is_symlink() or not ACTIVE_LEASE.is_file():
        raise AcceptanceError("MUTATION_LEASE_UNSAFE", "The active mutation lease is unsafe.")
    try:
        lease = json.loads(ACTIVE_LEASE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AcceptanceError("MUTATION_LEASE_INVALID", "The active mutation lease is invalid.") from error
    if not isinstance(lease, dict) or lease.get("schemaVersion") != "nvs.mutation-lease/v1":
        raise AcceptanceError("MUTATION_LEASE_INVALID", "The active mutation lease is invalid.")
    return lease


def _safe_release_path(value: Any) -> Path:
    if not isinstance(value, str):
        raise AcceptanceError("MUTATION_LEASE_INVALID", "The mutation lease path is invalid.")
    path = Path(value)
    if not path.is_absolute() or path.parent.resolve() != RELEASE_ROOT:
        raise AcceptanceError("MUTATION_LEASE_INVALID", "The mutation lease path escaped releases.")
    return path


def _launch_watchdog(lease: Mapping[str, Any]) -> None:
    watchdog_path = _safe_release_path(lease.get("watchdogPath"))
    pid_path = _safe_release_path(lease.get("watchdogPidPath"))
    if watchdog_path.exists() or pid_path.exists():
        raise AcceptanceError("WATCHDOG_PATH_COLLISION", "The mutation watchdog path already exists.")
    shutil.copy2(Path(__file__), watchdog_path)
    os.chmod(watchdog_path, 0o700)
    process = subprocess.Popen(
        [sys.executable, str(watchdog_path), "watchdog", "--lease-id", str(lease["leaseId"])],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd="/",
        start_new_session=True,
        close_fds=True,
    )
    raw, stat = _read_env()
    del raw
    _safe_atomic_write(
        pid_path,
        f"{process.pid}\n".encode("ascii"),
        mode=0o600,
        uid=stat.st_uid,
        gid=stat.st_gid,
    )


def _terminate_watchdog(lease: Mapping[str, Any]) -> None:
    pid_path = _safe_release_path(lease.get("watchdogPidPath"))
    if pid_path.is_file() and not pid_path.is_symlink():
        try:
            pid = int(pid_path.read_text(encoding="ascii").strip())
            if pid > 1 and pid != os.getpid():
                os.kill(pid, signal.SIGTERM)
        except (OSError, ValueError, ProcessLookupError):
            pass
    try:
        pid_path.unlink()
    except FileNotFoundError:
        pass
    watchdog_path = _safe_release_path(lease.get("watchdogPath"))
    try:
        watchdog_path.unlink()
    except FileNotFoundError:
        pass


def _restore_from_lease(lease_id: str | None, *, allow_orphan_disable: bool) -> str:
    RELEASE_ROOT.mkdir(parents=True, exist_ok=True)
    with CLEANUP_LOCK.open("a+", encoding="utf-8") as lock_handle:
        os.chmod(CLEANUP_LOCK, 0o600)
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        lease = _read_lease()
        if lease is None:
            raw, _stat = _read_env()
            if _switch_value(raw) != "true":
                return "NO_ACTIVE_LEASE"
            if not allow_orphan_disable:
                raise AcceptanceError(
                    "ORPHAN_MUTATION_SWITCH_ENABLED",
                    "The mutation switch is enabled without a recoverable lease.",
                )
            metadata = _runtime_metadata()
            _rewrite_switch(False)
            _recreate(metadata)
            return "ORPHAN_SWITCH_DISABLED"

        observed_lease_id = lease.get("leaseId")
        if lease_id and observed_lease_id != lease_id:
            raise AcceptanceError(
                "MUTATION_LEASE_MISMATCH",
                "The active mutation lease belongs to another operation.",
            )
        backup_path = _safe_release_path(lease.get("backupPath"))
        if backup_path.is_symlink() or not backup_path.is_file():
            raise AcceptanceError(
                "MUTATION_BACKUP_MISSING",
                "The original NVS .env backup is unavailable for restoration.",
            )
        runtime = lease.get("runtime")
        if not isinstance(runtime, dict):
            raise AcceptanceError("MUTATION_LEASE_INVALID", "The runtime lease metadata is invalid.")
        required_runtime = {key: runtime.get(key) for key in ("imageRef", "buildSha", "buildTimestamp", "releaseVersion")}
        if not all(isinstance(value, str) and value for value in required_runtime.values()):
            raise AcceptanceError("MUTATION_LEASE_INVALID", "The runtime lease metadata is incomplete.")

        current_raw, current_stat = _read_env()
        del current_raw
        _safe_atomic_write(
            ENV_FILE,
            backup_path.read_bytes(),
            mode=0o600,
            uid=current_stat.st_uid,
            gid=current_stat.st_gid,
        )
        _recreate(required_runtime)  # type: ignore[arg-type]
        restored_raw, _restored_stat = _read_env()
        if _switch_value(restored_raw) == "true":
            raise AcceptanceError(
                "MUTATION_SWITCH_RESTORE_FAILED",
                "The original environment still enables NILES mutations.",
            )
        _terminate_watchdog(lease)
        backup_path.unlink(missing_ok=True)
        ACTIVE_LEASE.unlink(missing_ok=True)
        return "LEASE_RESTORED"


def _store_private_report(run_id: str, report: Mapping[str, Any]) -> Path:
    path = RELEASE_ROOT / f"nvs-m1-02b-acceptance-{run_id}.json"
    raw, stat = _read_env()
    del raw
    payload = (json.dumps(report, indent=2, sort_keys=True) + "\n").encode("utf-8")
    _safe_atomic_write(path, payload, mode=0o600, uid=stat.st_uid, gid=stat.st_gid)
    return path


def _confirm_readiness(environment_id: str) -> dict[str, Any]:
    _status, readiness = _json_request(
        f"/api/environments/{environment_id}/execution-readiness/confirm",
        method="POST",
        body={"scenarioId": SCENARIO_ID, "variationValues": VARIATION_VALUES},
        timeout=60,
    )
    if not isinstance(readiness, dict):
        raise AcceptanceError("CONFIRMED_READINESS_INVALID", "Confirmed readiness is invalid.")
    if (
        readiness.get("verdict") != "PASS"
        or readiness.get("confirmed") is not True
        or readiness.get("mutationEligible") is not True
    ):
        error = readiness.get("error")
        code = error.get("code") if isinstance(error, dict) and isinstance(error.get("code"), str) else "CONFIRMED_READINESS_BLOCKED"
        raise AcceptanceError(code, "Confirmed read-only staging readiness is blocked.", result="BLOCKED")
    return readiness


def _start_live_run(environment_id: str, run_id: str) -> dict[str, Any]:
    _status, accepted = _json_request(
        "/api/runs",
        method="POST",
        body={
            "runType": "LIVE_API",
            "runId": run_id,
            "environmentId": environment_id,
            "scenarioId": SCENARIO_ID,
            "variationValues": VARIATION_VALUES,
            "confirmRealMutation": True,
        },
        timeout=60,
    )
    if not isinstance(accepted, dict) or accepted.get("runId") != run_id:
        raise AcceptanceError("LIVE_RUN_ACCEPTANCE_INVALID", "NVS did not return the requested run ID.")
    return accepted


def _poll_run(run_id: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    deadline = time.monotonic() + RUN_TIMEOUT_SECONDS
    latest: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        status, progress = _json_request(
            f"/api/runs/{run_id}/progress",
            allow_statuses={404},
            timeout=30,
        )
        if status == 404:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        if not isinstance(progress, dict):
            raise AcceptanceError("RUN_PROGRESS_INVALID", "NVS returned invalid run progress.")
        latest = progress
        state = progress.get("status")
        if state == "COMPLETED":
            _run_status, run = _json_request(f"/api/runs/{run_id}", timeout=30)
            if not isinstance(run, dict):
                raise AcceptanceError("FINAL_RUN_INVALID", "NVS returned an invalid final run.")
            return progress, run
        if state == "RECOVERY_REQUIRED":
            return progress, None
        time.sleep(POLL_INTERVAL_SECONDS)
    raise AcceptanceError(
        "LIVE_RUN_TIMEOUT",
        "The live run did not reach a terminal state before the safety deadline.",
        result="RECOVERY_REQUIRED",
    )


def _classify(run: Mapping[str, Any]) -> tuple[str, bool, dict[str, Any]]:
    verdict = run.get("verdict")
    error = run.get("error")
    error_code = error.get("code") if isinstance(error, dict) else None
    cleanup = run.get("cleanup") if isinstance(run.get("cleanup"), dict) else {}
    inventory = run.get("resourceInventory") if isinstance(run.get("resourceInventory"), dict) else {}
    incident = inventory.get("incident") if isinstance(inventory.get("incident"), dict) else {}
    steps = run.get("stepResults") if isinstance(run.get("stepResults"), list) else []
    required_steps = [step for step in steps if isinstance(step, dict) and step.get("required", True)]
    passed_required = [step for step in required_steps if step.get("executionStatus") == "PASS"]
    nonpass_required = [step for step in required_steps if step.get("executionStatus") != "PASS"]

    accepted_close_blocker = (
        verdict == "BLOCKED"
        and error_code == "NILES_CLOSE_AUTHORITY_UNSATISFIABLE"
        and cleanup.get("status") == "CLEAN"
        and cleanup.get("policy") == "DELETE_IF_RUN_OWNED"
        and incident.get("disposition") == "DELETED"
        and len(nonpass_required) == 1
        and isinstance(nonpass_required[0].get("error"), dict)
        and nonpass_required[0]["error"].get("code") == "NILES_CLOSE_AUTHORITY_UNSATISFIABLE"
    )
    passed = verdict == "PASS" or accepted_close_blocker
    classification = (
        "PASS"
        if verdict == "PASS"
        else "ACCEPTED_WITH_PRODUCT_BLOCKER"
        if accepted_close_blocker
        else "NOT_ACCEPTED"
    )
    summary = {
        "classification": classification,
        "verdict": verdict,
        "errorCode": error_code,
        "requiredStepsPassed": len(passed_required),
        "requiredStepsTotal": len(required_steps),
        "cleanupStatus": cleanup.get("status"),
        "cleanupPolicy": cleanup.get("policy"),
        "incidentDisposition": incident.get("disposition"),
    }
    return classification, passed, summary


def _print_summary(
    *,
    result: str,
    run_id: str,
    build_sha: str,
    report_path: Path | None,
    summary: Mapping[str, Any] | None = None,
    error: AcceptanceError | None = None,
    restore_status: str | None = None,
) -> None:
    print("# NVS M1-02B staging acceptance")
    print()
    print(f"- Result: `{result}`")
    print(f"- Run ID: `{run_id}`")
    print(f"- Deployed build SHA: `{build_sha}`")
    if summary:
        print(f"- Final NVS verdict: `{summary.get('verdict')}`")
        print(f"- Final error code: `{summary.get('errorCode') or 'NONE'}`")
        print(
            f"- Required steps: `{summary.get('requiredStepsPassed')}/{summary.get('requiredStepsTotal')}` PASS"
        )
        print(
            f"- Cleanup: `{summary.get('cleanupStatus')}` / `{summary.get('cleanupPolicy')}`"
        )
        print(f"- Incident disposition: `{summary.get('incidentDisposition') or 'UNKNOWN'}`")
    if error:
        print(f"- Error code: `{error.code}`")
        print(f"- Error: {error}")
    if report_path:
        print(f"- Private server report: `{report_path}`")
    if restore_status:
        print(f"- Mutation lease cleanup: `{restore_status}`")
    print()
    print("No credential, bearer token, raw payload, Incident UUID, or Incident number is printed here.")


def _run_acceptance(args: argparse.Namespace) -> int:
    if not SAFE_ID.fullmatch(args.environment_id):
        raise AcceptanceError("INVALID_ENVIRONMENT_ID", "environment_id is invalid.")
    if not SAFE_ID.fullmatch(args.run_id):
        raise AcceptanceError("INVALID_RUN_ID", "run_id is invalid.")
    if not FULL_SHA.fullmatch(args.expected_sha):
        raise AcceptanceError("INVALID_EXPECTED_SHA", "expected_sha must be a full Git SHA.")
    if args.confirmation != "RUN_M1_02B_LIVE_INCIDENT":
        raise AcceptanceError(
            "LIVE_MUTATION_CONFIRMATION_REQUIRED",
            "The exact live Incident confirmation phrase is required.",
            result="BLOCKED",
        )

    metadata = _runtime_metadata()
    if metadata["buildSha"] != args.expected_sha:
        raise AcceptanceError(
            "DEPLOYED_SHA_MISMATCH",
            "The running NVS build does not match expected_sha.",
            result="BLOCKED",
        )
    raw, _stat = _read_env()
    if _switch_value(raw) == "true":
        raise AcceptanceError(
            "MUTATION_SWITCH_ALREADY_ENABLED",
            "The mutation switch is already enabled outside this workflow.",
            result="BLOCKED",
        )

    lease = _create_lease(args.lease_id, metadata)
    _launch_watchdog(lease)
    private_report: Path | None = None
    final_summary: dict[str, Any] | None = None
    primary_error: AcceptanceError | None = None
    result = "FAIL"
    exit_code = 1
    restore_status: str | None = None

    try:
        _rewrite_switch(True)
        _recreate(metadata)
        readiness = _confirm_readiness(args.environment_id)
        accepted = _start_live_run(args.environment_id, args.run_id)
        progress, run = _poll_run(args.run_id)
        report = {
            "schemaVersion": "nvs.staging-acceptance-report/v1",
            "runId": args.run_id,
            "deployedBuildSha": metadata["buildSha"],
            "accepted": accepted,
            "confirmedReadiness": readiness,
            "progress": progress,
            "run": run,
            "completedAt": _iso(_utc_now()),
        }
        private_report = _store_private_report(args.run_id, report)
        if run is None:
            checkpoint = progress.get("checkpoint") if isinstance(progress.get("checkpoint"), dict) else {}
            code = (
                checkpoint.get("error", {}).get("code")
                if isinstance(checkpoint.get("error"), dict)
                else "LIVE_RUN_REQUIRES_RECOVERY"
            )
            raise AcceptanceError(
                code or "LIVE_RUN_REQUIRES_RECOVERY",
                "The live run requires operator recovery.",
                result="RECOVERY_REQUIRED",
            )
        classification, passed, final_summary = _classify(run)
        result = classification
        exit_code = 0 if passed else 2
        if not passed:
            primary_error = AcceptanceError(
                str(final_summary.get("errorCode") or "LIVE_RUN_NOT_ACCEPTED"),
                "The final run did not meet the M1-02B staging acceptance contract.",
                result="BLOCKED" if run.get("verdict") == "BLOCKED" else "FAIL",
            )
    except AcceptanceError as error:
        primary_error = error
        result = error.result
        exit_code = 3 if error.result == "RECOVERY_REQUIRED" else 2 if error.result == "BLOCKED" else 1
        if private_report is None:
            try:
                progress_status, progress = _json_request(
                    f"/api/runs/{args.run_id}/progress",
                    allow_statuses={404},
                    timeout=15,
                )
                private_report = _store_private_report(
                    args.run_id,
                    {
                        "schemaVersion": "nvs.staging-acceptance-report/v1",
                        "runId": args.run_id,
                        "deployedBuildSha": metadata["buildSha"],
                        "progress": progress if progress_status != 404 else None,
                        "operatorError": {"code": error.code, "result": error.result},
                        "completedAt": _iso(_utc_now()),
                    },
                )
            except Exception:
                private_report = None
    finally:
        try:
            restore_status = _restore_from_lease(args.lease_id, allow_orphan_disable=False)
        except AcceptanceError as cleanup_error:
            _print_summary(
                result="MUTATION_DISABLE_RECOVERY_REQUIRED",
                run_id=args.run_id,
                build_sha=metadata["buildSha"],
                report_path=private_report,
                summary=final_summary,
                error=cleanup_error,
                restore_status="FAILED",
            )
            return 4

    _print_summary(
        result=result,
        run_id=args.run_id,
        build_sha=metadata["buildSha"],
        report_path=private_report,
        summary=final_summary,
        error=primary_error,
        restore_status=restore_status,
    )
    return exit_code


def _watchdog(args: argparse.Namespace) -> int:
    try:
        lease = _read_lease()
        if lease is None or lease.get("leaseId") != args.lease_id:
            return 0
        expires_at = datetime.fromisoformat(str(lease.get("expiresAt")))
        delay = max(0.0, (expires_at - _utc_now()).total_seconds())
        time.sleep(delay)
        _restore_from_lease(args.lease_id, allow_orphan_disable=True)
        return 0
    except Exception:
        return 1


def _force_disable(args: argparse.Namespace) -> int:
    try:
        status = _restore_from_lease(args.lease_id or None, allow_orphan_disable=True)
        print("# NVS mutation safety cleanup")
        print()
        print(f"- Status: `{status}`")
        print("- Mutation switch: `DISABLED`")
        return 0
    except AcceptanceError as error:
        print("# NVS mutation safety cleanup")
        print()
        print("**Result:** FAIL")
        print()
        print(f"- Error code: `{error.code}`")
        print(f"- Error: {error}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded M1-02B live staging acceptance.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--environment-id", default="staging-example")
    run_parser.add_argument("--expected-sha", required=True)
    run_parser.add_argument("--run-id", required=True)
    run_parser.add_argument("--lease-id", required=True)
    run_parser.add_argument("--confirmation", required=True)

    watchdog_parser = subparsers.add_parser("watchdog")
    watchdog_parser.add_argument("--lease-id", required=True)

    cleanup_parser = subparsers.add_parser("force-disable")
    cleanup_parser.add_argument("--lease-id", default="")

    args = parser.parse_args()
    if args.command == "run":
        try:
            return _run_acceptance(args)
        except AcceptanceError as error:
            print("# NVS M1-02B staging acceptance")
            print()
            print(f"**Result:** {error.result}")
            print()
            print(f"- Error code: `{error.code}`")
            print(f"- Error: {error}")
            return 2 if error.result == "BLOCKED" else 1
        except Exception:
            print("# NVS M1-02B staging acceptance")
            print()
            print("**Result:** FAIL")
            print()
            print("An unexpected local acceptance error occurred; run force-disable immediately.")
            return 1
    if args.command == "watchdog":
        return _watchdog(args)
    return _force_disable(args)


if __name__ == "__main__":
    raise SystemExit(main())
