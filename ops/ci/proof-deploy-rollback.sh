#!/usr/bin/env bash
set -euo pipefail

GOOD_SHA="${1:?GOOD_SHA is required}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nvs-ci-deploy.XXXXXX")"
GOOD_IMAGE="nvs:${GOOD_SHA}"
BAD_SHA="$(printf 'b%.0s' {1..40})"
BAD_IMAGE="nvs:${BAD_SHA}"
CONTAINER_PORT=4120
trap '
  docker compose --project-directory "$WORK" -f "$WORK/docker-compose.staging.yml" stop nvs >/dev/null 2>&1 || true
  docker rm --force nvs >/dev/null 2>&1 || true
  rm -rf "$WORK"
' EXIT

mkdir -p "$WORK/config" "$WORK/data" "$WORK/ops" "$WORK/releases"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/config/"
cp "$ROOT/docker-compose.staging.yml" "$WORK/docker-compose.staging.yml"
cp "$ROOT/ops/deploy-staging.sh" "$ROOT/ops/verify-deployment.sh" "$WORK/ops/"
chmod 0750 "$WORK/ops/deploy-staging.sh" "$WORK/ops/verify-deployment.sh"
install -m 0600 /dev/null "$WORK/.env"
printf 'NVS_LOG_LEVEL=silent\n' >"$WORK/.env"
sudo chown -R 10001:10001 "$WORK/data"
sudo chmod 0750 "$WORK/data"
sudo chmod -R a+rX "$WORK/config"

docker tag "$GOOD_IMAGE" "$GOOD_IMAGE"
export NVS_IMAGE="$GOOD_IMAGE"
export NVS_BUILD_SHA="$GOOD_SHA"
export NVS_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export NVS_RELEASE_VERSION=0.1.0
export NVS_HOST_PORT="$CONTAINER_PORT"
docker compose --project-directory "$WORK" -f "$WORK/docker-compose.staging.yml" up -d --no-deps --force-recreate nvs
bash "$WORK/ops/verify-deployment.sh" "http://127.0.0.1:${CONTAINER_PORT}" "$GOOD_SHA" 90
GOOD_IMAGE_ID="$(docker container inspect --format '{{.Image}}' nvs)"

# Intentionally unhealthy deployment image: same layout labels, but never starts the API.
docker build --quiet \
  --build-arg "NVS_BUILD_SHA=${BAD_SHA}" \
  --build-arg "NVS_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg NVS_RELEASE_VERSION=0.1.0-unhealthy \
  -f - -t "$BAD_IMAGE" "$ROOT" <<'DOCKER'
# syntax=docker/dockerfile:1.7
FROM node:24.18.0-bookworm-slim
ARG NVS_BUILD_SHA=unknown
ARG NVS_BUILD_TIMESTAMP=unknown
ARG NVS_RELEASE_VERSION=0.1.0-unhealthy
LABEL org.opencontainers.image.revision="${NVS_BUILD_SHA}"
LABEL org.opencontainers.image.created="${NVS_BUILD_TIMESTAMP}"
LABEL org.opencontainers.image.version="${NVS_RELEASE_VERSION}"
USER 10001:10001
CMD ["node", "-e", "setInterval(() => {}, 60000)"]
DOCKER

ARCHIVE="$WORK/releases/nvs-${BAD_SHA}.tar.gz"
docker save "$BAD_IMAGE" | gzip -9 >"$ARCHIVE"
DIGEST="$(sha256sum -- "$ARCHIVE" | awk '{ print $1 }')"

# Redeploying the same Git SHA must keep an immutable rollback reference.
docker tag "$GOOD_IMAGE_ID" "nvs:${GOOD_SHA}"
SAME_ARCHIVE="$WORK/releases/nvs-${GOOD_SHA}-again.tar.gz"
docker save "nvs:${GOOD_SHA}" | gzip -9 >"$SAME_ARCHIVE"
SAME_DIGEST="$(sha256sum -- "$SAME_ARCHIVE" | awk '{ print $1 }')"
FAILING_VERIFY="$WORK/ops/always-fail-verify.sh"
cat >"$FAILING_VERIFY" <<'EOF'
#!/usr/bin/env bash
echo "Forced verification failure for same-SHA coverage." >&2
exit 1
EOF
chmod 0750 "$FAILING_VERIFY"

set +e
NVS_DEPLOY_SHA="$GOOD_SHA" \
  NVS_IMAGE_ARCHIVE="$SAME_ARCHIVE" \
  NVS_IMAGE_ARCHIVE_SHA256="$SAME_DIGEST" \
  NVS_DEPLOY_PATH="$WORK" \
  NVS_HOST_PORT="$CONTAINER_PORT" \
  NVS_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  NVS_RELEASE_VERSION=0.1.0 \
  NVS_HEALTH_URL="http://127.0.0.1:${CONTAINER_PORT}" \
  NVS_VERIFY_SCRIPT="$FAILING_VERIFY" \
  "$WORK/ops/deploy-staging.sh"
same_status=$?
set -e
[[ "$same_status" -ne 0 ]] || {
  echo "Same-SHA forced failure was expected to exit non-zero." >&2
  exit 1
}
bash "$WORK/ops/verify-deployment.sh" "http://127.0.0.1:${CONTAINER_PORT}" "$GOOD_SHA" 90
RESTORED_AFTER_SAME="$(docker container inspect --format '{{.Image}}' nvs)"
[[ "$RESTORED_AFTER_SAME" == "$GOOD_IMAGE_ID" ]] || {
  echo "Same-SHA rollback did not restore the immutable previous image ID." >&2
  echo "expected=${GOOD_IMAGE_ID} actual=${RESTORED_AFTER_SAME}" >&2
  exit 1
}

set +e
NVS_DEPLOY_SHA="$BAD_SHA" \
  NVS_IMAGE_ARCHIVE="$ARCHIVE" \
  NVS_IMAGE_ARCHIVE_SHA256="$DIGEST" \
  NVS_DEPLOY_PATH="$WORK" \
  NVS_HOST_PORT="$CONTAINER_PORT" \
  NVS_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  NVS_RELEASE_VERSION=0.1.0-unhealthy \
  NVS_HEALTH_URL="http://127.0.0.1:${CONTAINER_PORT}" \
  "$WORK/ops/deploy-staging.sh"
deploy_status=$?
set -e
[[ "$deploy_status" -ne 0 ]] || {
  echo "Unhealthy deployment was expected to exit non-zero." >&2
  exit 1
}

bash "$WORK/ops/verify-deployment.sh" "http://127.0.0.1:${CONTAINER_PORT}" "$GOOD_SHA" 90
RESTORED_ID="$(docker container inspect --format '{{.Image}}' nvs)"
[[ "$RESTORED_ID" == "$GOOD_IMAGE_ID" ]] || {
  echo "Rollback did not restore the original immutable image ID." >&2
  echo "expected=${GOOD_IMAGE_ID} actual=${RESTORED_ID}" >&2
  exit 1
}

# Checksum mismatch must fail before replacing the running service.
BAD_DIGEST="$(printf 'a%.0s' {1..64})"
BEFORE_MISMATCH_ID="$(docker container inspect --format '{{.Image}}' nvs)"
set +e
NVS_DEPLOY_SHA="$BAD_SHA" \
  NVS_IMAGE_ARCHIVE="$ARCHIVE" \
  NVS_IMAGE_ARCHIVE_SHA256="$BAD_DIGEST" \
  NVS_DEPLOY_PATH="$WORK" \
  NVS_HOST_PORT="$CONTAINER_PORT" \
  NVS_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  NVS_RELEASE_VERSION=0.1.0-unhealthy \
  NVS_HEALTH_URL="http://127.0.0.1:${CONTAINER_PORT}" \
  "$WORK/ops/deploy-staging.sh"
mismatch_status=$?
set -e
[[ "$mismatch_status" -ne 0 ]] || {
  echo "Checksum mismatch should fail." >&2
  exit 1
}
AFTER_MISMATCH_ID="$(docker container inspect --format '{{.Image}}' nvs)"
[[ "$AFTER_MISMATCH_ID" == "$BEFORE_MISMATCH_ID" ]] || {
  echo "Checksum mismatch changed the running service." >&2
  exit 1
}
bash "$WORK/ops/verify-deployment.sh" "http://127.0.0.1:${CONTAINER_PORT}" "$GOOD_SHA" 90

echo "Deploy rollback and archive integrity proofs passed."
