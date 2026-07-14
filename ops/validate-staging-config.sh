#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${1:-/opt/nvs/config}"
DATA_DIR="${2:-/opt/nvs/data}"
VALIDATE_IMAGE="${NVS_VALIDATE_IMAGE:-}"

if [[ ! -d "$CONFIG_DIR" || ! -d "$DATA_DIR" ]]; then
  echo "Usage: validate-staging-config.sh <config-dir> <data-dir>" >&2
  echo "Optionally set NVS_VALIDATE_IMAGE to an already transferred NVS image." >&2
  exit 2
fi

if [[ -z "$VALIDATE_IMAGE" ]]; then
  echo "NVS_VALIDATE_IMAGE is required so validation uses the same runtime contracts as deployment." >&2
  exit 2
fi

docker image inspect "$VALIDATE_IMAGE" >/dev/null
docker run --rm --user 10001:10001 --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --mount "type=bind,src=${CONFIG_DIR},dst=/app/config,readonly" \
  --mount "type=bind,src=${DATA_DIR},dst=/var/lib/nvs" \
  -e NVS_CONFIG_DIR=/app/config \
  -e NVS_DATA_DIR=/var/lib/nvs \
  -e NVS_WEB_DIR=/app/web \
  -w /app \
  "$VALIDATE_IMAGE" \
  node api/cli.js ready-check
