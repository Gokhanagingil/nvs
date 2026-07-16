#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any


SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
ALLOWED_OUTPUT_ROOT = Path("/opt/nvs/releases")


class StoreError(RuntimeError):
    """A sanitized discovery-store failure."""


def _safe_error(stderr: str, return_code: int) -> str:
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


def _write_atomic(output_path: Path, payload: bytes) -> None:
    resolved_parent = output_path.parent.resolve()
    if resolved_parent != ALLOWED_OUTPUT_ROOT:
        raise StoreError("discovery output must remain under /opt/nvs/releases.")
    if output_path.is_symlink():
        raise StoreError("refusing to replace a symbolic-link discovery output.")
    resolved_parent.mkdir(parents=False, exist_ok=True)

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        dir=resolved_parent,
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, output_path)
        os.chmod(output_path, 0o600)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def _count_list(container: dict[str, Any], key: str) -> int:
    value = container.get(key)
    return len(value) if isinstance(value, list) else 0


def _run(args: argparse.Namespace) -> int:
    if not SAFE_ID.fullmatch(args.environment_id):
        raise StoreError("environment_id is not a safe NVS identifier.")
    if len(args.query) > 100 or any(ord(character) < 32 for character in args.query):
        raise StoreError("query must be at most 100 printable characters.")

    discovery_script = Path(args.discovery_script)
    if not discovery_script.is_file():
        raise StoreError("the container discovery script was not found.")

    output_path = Path(args.output_file)
    if not output_path.is_absolute():
        raise StoreError("discovery output path must be absolute.")

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
        raise StoreError("docker is not available to the staging deploy user.") from error
    except subprocess.TimeoutExpired as error:
        raise StoreError("fixture discovery exceeded its 90-second safety deadline.") from error

    stderr = completed.stderr.decode("utf-8", errors="replace").strip()
    if completed.returncode != 0:
        raise StoreError(_safe_error(stderr, completed.returncode))

    raw = completed.stdout.strip()
    try:
        discovery = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise StoreError("fixture discovery returned an invalid sanitized result.") from error
    if not isinstance(discovery, dict):
        raise StoreError("fixture discovery returned an unexpected result shape.")

    serialized = (json.dumps(discovery, indent=2, sort_keys=True) + "\n").encode("utf-8")
    _write_atomic(output_path, serialized)

    candidates = discovery.get("candidates")
    candidate_map = candidates if isinstance(candidates, dict) else {}
    choices = discovery.get("choices")
    choice_map = choices if isinstance(choices, dict) else {}
    errors = discovery.get("errors")
    error_list = errors if isinstance(errors, list) else []

    print("# NILES staging fixture discovery")
    print()
    print(
        "The detailed sanitized candidate inventory was stored on the staging host "
        "and was not written to public GitHub logs."
    )
    print()
    print(f"- Environment: `{discovery.get('environmentId', 'unknown')}`")
    print(f"- Query: `{discovery.get('query') or '(none)'}`")
    print(f"- Server file: `{output_path}`")
    print(f"- Assignment groups: `{_count_list(candidate_map, 'assignmentGroups')}`")
    print(f"- CMDB services: `{_count_list(candidate_map, 'services')}`")
    print(f"- Service offerings: `{_count_list(candidate_map, 'offerings')}`")
    print(f"- Configuration items: `{_count_list(candidate_map, 'configurationItems')}`")
    print(f"- Pending-reason choices: `{_count_list(choice_map, 'pendingReason')}`")
    print(f"- Relationship choices: `{_count_list(choice_map, 'relationshipType')}`")
    print(f"- Impact-scope choices: `{_count_list(choice_map, 'impactScope')}`")
    print(f"- Incomplete scopes: `{len(error_list)}`")
    print()
    print(f"**Result:** {'PARTIAL' if error_list else 'PASS'}")
    return 2 if error_list else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Store a sanitized fixture discovery result on the staging host."
    )
    parser.add_argument("--environment-id", default="staging-example")
    parser.add_argument("--query", default="")
    parser.add_argument("--discovery-script", required=True)
    parser.add_argument(
        "--output-file",
        default="/opt/nvs/releases/nvs-fixture-discovery-latest.json",
    )
    args = parser.parse_args()
    try:
        return _run(args)
    except StoreError as error:
        print("# NILES staging fixture discovery")
        print()
        print("**Result:** FAIL")
        print()
        print(str(error))
        return 1
    except Exception:
        print("# NILES staging fixture discovery")
        print()
        print("**Result:** FAIL")
        print()
        print("An unexpected local storage error occurred; no secret values were emitted.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
