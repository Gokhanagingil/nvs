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
  sudo rm -rf "$WORK" >/dev/null 2>&1 || rm -rf "$WORK" >/dev/null 2>&1 || true
' EXIT

if ! id -u nvsdeploy >/dev/null 2>&1; then
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin nvsdeploy
fi

mkdir -p "$WORK/config" "$WORK/data" "$WORK/ops" "$WORK/releases"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/config/"
cp "$ROOT/docker-compose.staging.yml" "$WORK/docker-compose.staging.yml"
cp "$ROOT/ops/deploy-staging.sh" "$ROOT/ops/verify-deployment.sh" "$WORK/ops/"
chmod 0750 "$WORK/ops/deploy-staging.sh" "$WORK/ops/verify-deployment.sh"
install -m 0600 /dev/null "$WORK/.env"
printf 'NVS_LOG_LEVEL=silent\n' >"$WORK/.env"
sudo chown -R nvsdeploy:10001 "$WORK/config"
sudo find "$WORK/config" -type d -exec chmod 0750 {} +
sudo find "$WORK/config" -type f -exec chmod 0640 {} +
sudo chown -R 10001:10001 "$WORK/data"
sudo chmod 0750 "$WORK/data"

export NVS_IMAGE="$GOOD_IMAGE"
export NVS_BUILD_SHA="$GOOD_SHA"
export NVS_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export NVS_RELEASE_VERSION=0.1.0
export NVS_HOST_PORT="$CONTAINER_PORT"
docker compose --project-directory "$WORK" -f "$WORK/docker-compose.staging.yml" up -d --no-deps --force-recreate nvs
bash "$WORK/ops/verify-deployment.sh" "http://127.0.0.1:${CONTAINER_PORT}" "$GOOD_SHA" 90
IMAGE_ID_A="$(docker container inspect --format '{{.Image}}' nvs)"

# Distinct collision image B: same OCI revision/Git SHA label, different image ID.
COLLISION_IMAGE="nvs-collision-b:${GOOD_SHA}"
docker build --quiet \
  --build-arg "NVS_BUILD_SHA=${GOOD_SHA}" \
  --build-arg "NVS_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg NVS_RELEASE_VERSION=0.1.0-collision \
  -f - -t "$COLLISION_IMAGE" "$ROOT" <<'DOCKER'
# syntax=docker/dockerfile:1.7
FROM node:24.18.0-bookworm-slim
ARG NVS_BUILD_SHA=unknown
ARG NVS_BUILD_TIMESTAMP=unknown
ARG NVS_RELEASE_VERSION=0.1.0-collision
LABEL org.opencontainers.image.revision="${NVS_BUILD_SHA}"
LABEL org.opencontainers.image.created="${NVS_BUILD_TIMESTAMP}"
LABEL org.opencontainers.image.version="${NVS_RELEASE_VERSION}"
# Distinct filesystem layer so image ID cannot equal the healthy production image.
ENV NVS_COLLISION_MARKER=same-sha-distinct-id
USER 10001:10001
CMD ["node", "-e", "setInterval(() => {}, 60000)"]
DOCKER

IMAGE_ID_B="$(docker image inspect --format '{{.Id}}' "$COLLISION_IMAGE")"
[[ -n "$IMAGE_ID_A" && -n "$IMAGE_ID_B" && "$IMAGE_ID_A" != "$IMAGE_ID_B" ]] || {
  echo "Same-SHA collision requires distinct image IDs." >&2
  echo "A=${IMAGE_ID_A} B=${IMAGE_ID_B}" >&2
  exit 1
}
echo "Same-SHA collision image IDs: A=${IMAGE_ID_A} B=${IMAGE_ID_B}"

# Move the mutable nvs:<same-sha> tag from A to B before archival/deploy.
docker tag "$IMAGE_ID_B" "nvs:${GOOD_SHA}"
TAG_AFTER_MOVE="$(docker image inspect --format '{{.Id}}' "nvs:${GOOD_SHA}")"
[[ "$TAG_AFTER_MOVE" == "$IMAGE_ID_B" ]] || {
  echo "Mutable tag nvs:${GOOD_SHA} did not move to image B." >&2
  exit 1
}

SAME_ARCHIVE="$WORK/releases/nvs-${GOOD_SHA}-collision.tar.gz"
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
  NVS_RELEASE_VERSION=0.1.0-collision \
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
[[ "$RESTORED_AFTER_SAME" == "$IMAGE_ID_A" ]] || {
  echo "Same-SHA rollback did not restore immutable image ID A." >&2
  echo "expected=${IMAGE_ID_A} actual=${RESTORED_AFTER_SAME}" >&2
  exit 1
}
echo "Same-SHA rollback restored image ID A (${IMAGE_ID_A})."

# Intentionally unhealthy deployment image with a different SHA.
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
[[ "$RESTORED_ID" == "$IMAGE_ID_A" ]] || {
  echo "Rollback did not restore the original immutable image ID." >&2
  echo "expected=${IMAGE_ID_A} actual=${RESTORED_ID}" >&2
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
