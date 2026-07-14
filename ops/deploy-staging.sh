#!/usr/bin/env bash
set -euo pipefail

DEPLOY_SHA="${NVS_DEPLOY_SHA:-}"
IMAGE_ARCHIVE="${NVS_IMAGE_ARCHIVE:-}"
IMAGE_ARCHIVE_SHA256="${NVS_IMAGE_ARCHIVE_SHA256:-}"
DEPLOY_PATH="${NVS_DEPLOY_PATH:-/opt/nvs}"
HOST_PORT="${NVS_HOST_PORT:-4100}"
BUILD_TIMESTAMP="${NVS_BUILD_TIMESTAMP:-}"
RELEASE_VERSION="${NVS_RELEASE_VERSION:-0.1.0}"
COMPOSE_FILE="${NVS_COMPOSE_FILE:-${DEPLOY_PATH}/docker-compose.staging.yml}"
HEALTH_URL="${NVS_HEALTH_URL:-http://127.0.0.1:${HOST_PORT}}"
VERIFY_SCRIPT="${NVS_VERIFY_SCRIPT:-${DEPLOY_PATH}/ops/verify-deployment.sh}"
ROLLBACK_RETENTION="${NVS_ROLLBACK_RETENTION:-5}"
CONTAINER_NAME="nvs"

fail_input() {
  echo "$1" >&2
  exit 2
}

[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || fail_input "NVS_DEPLOY_SHA must be a full Git SHA."
[[ "$DEPLOY_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$DEPLOY_PATH" != *".."* ]] ||
  fail_input "NVS_DEPLOY_PATH is invalid."
[[ "$HOST_PORT" =~ ^[0-9]{1,5}$ ]] && (( HOST_PORT >= 1 && HOST_PORT <= 65535 )) ||
  fail_input "NVS_HOST_PORT is invalid."
[[ "$BUILD_TIMESTAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
  fail_input "NVS_BUILD_TIMESTAMP must be a UTC ISO-8601 timestamp."
[[ "$RELEASE_VERSION" =~ ^[A-Za-z0-9._+-]{1,64}$ ]] ||
  fail_input "NVS_RELEASE_VERSION is invalid."
[[ "$IMAGE_ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  fail_input "NVS_IMAGE_ARCHIVE_SHA256 must be a lowercase SHA-256 digest."
[[ "$ROLLBACK_RETENTION" =~ ^[1-9][0-9]?$ ]] && (( ROLLBACK_RETENTION <= 20 )) ||
  fail_input "NVS_ROLLBACK_RETENTION must be between 1 and 20."
[[ -f "$IMAGE_ARCHIVE" ]] || fail_input "The transferred image archive is missing."
[[ -f "$COMPOSE_FILE" ]] || fail_input "The staging Compose file is missing."
[[ -x "$VERIFY_SCRIPT" ]] || fail_input "The deployment verification script is missing."
[[ -f "${DEPLOY_PATH}/.env" ]] || fail_input "Server-owned ${DEPLOY_PATH}/.env is missing."
[[ -d "${DEPLOY_PATH}/config" && -d "${DEPLOY_PATH}/data" ]] ||
  fail_input "Server-owned config or data directory is missing."

compose() {
  docker compose --project-directory "$DEPLOY_PATH" -f "$COMPOSE_FILE" "$@"
}

image_label() {
  docker image inspect --format "{{ index .Config.Labels \"$2\" }}" "$1" 2>/dev/null || true
}

prune_rollback_tags() {
  mapfile -t rollback_images < <(
    docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' 'nvs-rollback' 2>/dev/null |
      sort -k2,3r |
      awk '{ print $1 }'
  )
  if ((${#rollback_images[@]} <= ROLLBACK_RETENTION)); then
    return 0
  fi
  local stale
  for stale in "${rollback_images[@]:ROLLBACK_RETENTION}"; do
    docker image rm --force "$stale" >/dev/null 2>&1 || true
  done
}

safe_diagnostics() {
  docker ps -a --filter "name=^/${CONTAINER_NAME}$" \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' || true
  docker logs --tail 100 "$CONTAINER_NAME" 2>&1 |
    sed -E \
      -e 's/([Pp]assword|[Aa]ccess[Tt]oken|[Rr]efresh[Tt]oken|[Aa]uthorization|[Mm]fa[Tt]oken)[^,}]*/\1=[REDACTED]/g' \
      -e 's/Bearer[[:space:]]+[A-Za-z0-9._~+\/-]+/Bearer [REDACTED]/g' || true
}

previous_image_id=""
previous_sha=""
previous_timestamp=""
previous_version=""
rollback_tag=""

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  previous_image_id="$(docker container inspect --format '{{.Image}}' "$CONTAINER_NAME")"
  previous_sha="$(image_label "$previous_image_id" org.opencontainers.image.revision)"
  previous_timestamp="$(image_label "$previous_image_id" org.opencontainers.image.created)"
  previous_version="$(image_label "$previous_image_id" org.opencontainers.image.version)"
  if [[ "$previous_image_id" =~ ^sha256:[0-9a-f]{64}$ && "$previous_sha" =~ ^[0-9a-f]{40}$ ]]; then
    rollback_tag="nvs-rollback:${previous_sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    docker tag "$previous_image_id" "$rollback_tag"
  else
    previous_image_id=""
    previous_sha=""
    previous_timestamp=""
    previous_version=""
  fi
fi

actual_digest="$(sha256sum -- "$IMAGE_ARCHIVE" | awk '{ print $1 }')"
if [[ "$actual_digest" != "$IMAGE_ARCHIVE_SHA256" ]]; then
  echo "Image archive checksum mismatch; refusing to load or replace the running service." >&2
  if [[ -n "$rollback_tag" ]]; then
    docker image rm --force "$rollback_tag" >/dev/null 2>&1 || true
  fi
  exit 1
fi

gzip --decompress --stdout "$IMAGE_ARCHIVE" | docker load >/dev/null
new_image="nvs:${DEPLOY_SHA}"
docker image inspect "$new_image" >/dev/null
loaded_sha="$(image_label "$new_image" org.opencontainers.image.revision)"
[[ "$loaded_sha" == "$DEPLOY_SHA" ]] ||
  fail_input "Loaded image metadata does not match the requested SHA."

export NVS_IMAGE="$new_image"
export NVS_BUILD_SHA="$DEPLOY_SHA"
export NVS_BUILD_TIMESTAMP="$BUILD_TIMESTAMP"
export NVS_RELEASE_VERSION="$RELEASE_VERSION"
export NVS_HOST_PORT="$HOST_PORT"

compose config --quiet
if compose up -d --no-deps --force-recreate nvs; then
  if "$VERIFY_SCRIPT" "$HEALTH_URL" "$DEPLOY_SHA" 120; then
    echo "Staging deployment completed for ${DEPLOY_SHA}."
    prune_rollback_tags
    exit 0
  fi
fi

echo "Deployment verification failed; collecting redacted diagnostics." >&2
safe_diagnostics

if [[ -n "$rollback_tag" && -n "$previous_sha" ]]; then
  echo "Restoring previously active image ${rollback_tag} (${previous_image_id})." >&2
  export NVS_IMAGE="$rollback_tag"
  export NVS_BUILD_SHA="$previous_sha"
  export NVS_BUILD_TIMESTAMP="${previous_timestamp:-unknown}"
  export NVS_RELEASE_VERSION="${previous_version:-unknown}"
  compose up -d --no-deps --force-recreate nvs
  if "$VERIFY_SCRIPT" "$HEALTH_URL" "$previous_sha" 120; then
    echo "Rollback verified at ${previous_sha} via immutable image ID." >&2
  else
    echo "Rollback was attempted but did not become healthy." >&2
    safe_diagnostics
  fi
else
  echo "No verifiable previous NVS image was available; stopping the failed NVS service." >&2
  compose stop nvs || true
fi

exit 1
