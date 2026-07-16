#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
DEPLOY_ROOT = Path("/opt/nvs")
CONFIG_ROOT = DEPLOY_ROOT / "config"
RELEASE_ROOT = DEPLOY_ROOT / "releases"
ENV_FILE = DEPLOY_ROOT / ".env"
RUNTIME_GID = 10001


class GuardError(RuntimeError):
    """A sanitized guarded-application failure."""


def _run(
    command: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout: int = 180,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
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
        raise GuardError(f"required local command failed to start: {command[0]}") from error
    if check and completed.returncode != 0:
        raise GuardError(f"local command failed safely: {command[0]}")
    return completed


def _mutations_disabled() -> bool:
    if ENV_FILE.is_symlink() or not ENV_FILE.is_file():
        raise GuardError("the server-owned NVS .env file is unavailable or unsafe.")
    observed = "false"
    try:
        for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == "NVS_ENABLE_NILES_MUTATIONS":
                observed = value.strip().strip("'\"").casefold()
    except OSError as error:
        raise GuardError("the server-owned NVS .env file could not be checked.") from error
    return observed != "true"


def _metadata() -> tuple[str, str, str, str]:
    image_ref = _run(
        ["docker", "inspect", "--format", "{{.Config.Image}}", "nvs"]
    ).stdout.strip()
    image_id = _run(
        ["docker", "inspect", "--format", "{{.Image}}", "nvs"]
    ).stdout.strip()
    build_sha = _run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}",
            image_id,
        ]
    ).stdout.strip()
    build_timestamp = _run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.created\" }}",
            image_id,
        ]
    ).stdout.strip()
    release_version = _run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"org.opencontainers.image.version\" }}",
            image_id,
        ]
    ).stdout.strip()
    if not FULL_SHA.fullmatch(build_sha):
        raise GuardError("running NVS image does not expose a valid build SHA.")
    return image_ref, build_sha, build_timestamp, release_version


def _snapshot(path: Path, label: str, suffix: str) -> Path | None:
    if path.is_symlink():
        raise GuardError(f"refusing unsafe symbolic-link config path: {path}.")
    if not path.exists():
        return None
    backup = RELEASE_ROOT / f"nvs-{label}-preapply-{suffix}.yaml"
    shutil.copy2(path, backup)
    os.chmod(backup, 0o600)
    return backup


def _normalize(path: Path, image_ref: str) -> None:
    if not path.exists():
        return
    os.chmod(path, 0o640)
    try:
        os.chown(path, path.stat().st_uid, RUNTIME_GID)
        return
    except PermissionError:
        pass
    deploy_uid = os.getuid()
    relative = path.relative_to(CONFIG_ROOT)
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
            f"chown {deploy_uid}:{RUNTIME_GID} '/config/{relative}' && chmod 0640 '/config/{relative}'",
        ]
    )


def _restore(path: Path, backup: Path | None, image_ref: str) -> None:
    if backup is None:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    else:
        shutil.copy2(backup, path)
    _normalize(path, image_ref)


def _recreate(
    image_ref: str, build_sha: str, build_timestamp: str, release_version: str
) -> None:
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
    _run(
        [*compose, "up", "-d", "--no-deps", "--force-recreate", "nvs"],
        env=environment,
    )
    _run(
        [
            str(DEPLOY_ROOT / "ops" / "verify-deployment.sh"),
            "http://127.0.0.1:4100",
            build_sha,
            "120",
        ],
        timeout=150,
    )


def _run_guard(args: argparse.Namespace) -> int:
    if args.expected_sha and not FULL_SHA.fullmatch(args.expected_sha):
        raise GuardError("expected_sha must be empty or a full lowercase Git SHA.")
    if not _mutations_disabled():
        raise GuardError("fixture application requires NVS mutations to remain disabled.")

    apply_script = Path(args.apply_script)
    if not apply_script.is_file():
        raise GuardError("the reviewed fixture application script was not found.")

    image_ref, build_sha, build_timestamp, release_version = _metadata()
    if args.expected_sha and args.expected_sha != build_sha:
        raise GuardError("the running NVS build does not match expected_sha.")

    environment_path = CONFIG_ROOT / "environments" / "staging.yaml"
    fixture_path = CONFIG_ROOT / "fixtures" / "niles-incident" / "staging.yaml"
    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    environment_backup = _snapshot(environment_path, "environment", suffix)
    fixture_backup = _snapshot(fixture_path, "fixture", suffix)

    apply_environment = dict(os.environ)
    apply_environment["NVS_FIXTURE_APPLY_GUARDED"] = "1"
    completed = _run(
        [
            "python3",
            str(apply_script),
            "--environment-id",
            args.environment_id,
            "--proposal-digest",
            args.proposal_digest,
            "--confirmation",
            args.confirmation,
        ],
        env=apply_environment,
        timeout=420,
        check=False,
    )
    if completed.returncode == 0:
        if not _mutations_disabled():
            _restore(environment_path, environment_backup, image_ref)
            _restore(fixture_path, fixture_backup, image_ref)
            _recreate(image_ref, build_sha, build_timestamp, release_version)
            raise GuardError("mutation switch changed unexpectedly during fixture application.")
        print(completed.stdout.rstrip())
        print(f"- Guarded deployed SHA check: `{build_sha}`")
        print("- Outer rollback snapshots: `AVAILABLE`")
        return 0

    _restore(environment_path, environment_backup, image_ref)
    _restore(fixture_path, fixture_backup, image_ref)
    try:
        _recreate(image_ref, build_sha, build_timestamp, release_version)
    except Exception as error:
        raise GuardError(
            "fixture application failed and the outer rollback could not re-verify NVS."
        ) from error
    safe_output = completed.stdout.strip()
    if safe_output:
        print(safe_output)
    raise GuardError("fixture application failed; the original NVS configuration was restored.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Guard exact build identity and rollback around fixture application."
    )
    parser.add_argument("--environment-id", default="staging-example")
    parser.add_argument("--expected-sha", default="")
    parser.add_argument("--proposal-digest", required=True)
    parser.add_argument("--confirmation", required=True)
    parser.add_argument("--apply-script", required=True)
    args = parser.parse_args()
    try:
        return _run_guard(args)
    except GuardError as error:
        print("# NVS staging fixture application guard")
        print()
        print("**Result:** BLOCKED")
        print()
        print(str(error))
        return 2
    except Exception:
        print("# NVS staging fixture application guard")
        print()
        print("**Result:** FAIL")
        print()
        print("An unexpected guard error occurred; no secret values were emitted.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
