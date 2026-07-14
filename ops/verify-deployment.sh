#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
EXPECTED_SHA="${2:-}"
TIMEOUT_SECONDS="${3:-90}"

if [[ ! "$BASE_URL" =~ ^https?://[A-Za-z0-9._:-]+$ ]]; then
  echo "Invalid NVS health URL." >&2
  exit 2
fi
if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected build SHA must be a full lowercase Git SHA." >&2
  exit 2
fi
if [[ ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]{0,2}$ ]] || (( TIMEOUT_SECONDS > 600 )); then
  echo "Timeout must be between 1 and 600 seconds." >&2
  exit 2
fi

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  live="$(curl --fail --silent --show-error --max-time 5 "${BASE_URL}/api/health/live" 2>/dev/null || true)"
  ready="$(curl --fail --silent --show-error --max-time 5 "${BASE_URL}/api/health/ready" 2>/dev/null || true)"
  if [[ "$live" == *'"status":"ok"'* && "$ready" == *'"status":"ready"'* ]]; then
    version="$(curl --fail --silent --show-error --max-time 5 "${BASE_URL}/api/version")"
    compact_version="$(printf '%s' "$version" | tr -d '[:space:]')"
    if [[ "$compact_version" != *"\"buildSha\":\"${EXPECTED_SHA}\""* ]]; then
      echo "NVS is healthy but reports a different build SHA." >&2
      exit 1
    fi
    printf '%s\n' "$version"
    echo "NVS deployment verified at ${EXPECTED_SHA}."
    exit 0
  fi
  sleep 2
done

echo "NVS did not become live and ready before the deadline." >&2
exit 1
