#!/usr/bin/env bash
set -euo pipefail

ROLLBACK_SHA="${1:-}"
DEPLOY_PATH="${NVS_DEPLOY_PATH:-/opt/nvs}"
HOST_PORT="${NVS_HOST_PORT:-4100}"
HEALTH_URL="${NVS_HEALTH_URL:-http://127.0.0.1:${HOST_PORT}}"
COMPOSE_FILE="${NVS_COMPOSE_FILE:-${DEPLOY_PATH}/docker-compose.staging.yml}"
VERIFY_SCRIPT="${NVS_VERIFY_SCRIPT:-${DEPLOY_PATH}/ops/verify-deployment.sh}"

if [[ ! "$ROLLBACK_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: rollback-staging.sh <full-lowercase-build-sha>" >&2
  exit 2
fi
if [[ ! "$DEPLOY_PATH" =~ ^/[A-Za-z0-9._/-]+$ || "$DEPLOY_PATH" == *".."* ]]; then
  echo "NVS_DEPLOY_PATH is invalid." >&2
  exit 2
fi
if [[ ! "$HOST_PORT" =~ ^[0-9]{1,5}$ ]] || (( HOST_PORT < 1 || HOST_PORT > 65535 )); then
  echo "NVS_HOST_PORT is invalid." >&2
  exit 2
fi

image="nvs:${ROLLBACK_SHA}"
docker image inspect "$image" >/dev/null
image_sha="$(
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image"
)"
if [[ "$image_sha" != "$ROLLBACK_SHA" ]]; then
  echo "Rollback image metadata does not match the requested SHA." >&2
  exit 1
fi

export NVS_IMAGE="$image"
export NVS_BUILD_SHA="$ROLLBACK_SHA"
export NVS_BUILD_TIMESTAMP="$(
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.created" }}' "$image"
)"
export NVS_RELEASE_VERSION="$(
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image"
)"
export NVS_HOST_PORT="$HOST_PORT"

docker compose --project-directory "$DEPLOY_PATH" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate nvs
"$VERIFY_SCRIPT" "$HEALTH_URL" "$ROLLBACK_SHA" 120
echo "Manual rollback verified at ${ROLLBACK_SHA}."
