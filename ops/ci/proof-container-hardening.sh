#!/usr/bin/env bash
set -euo pipefail

BUILD_SHA="${1:?BUILD_SHA is required}"
IMAGE="nvs:${BUILD_SHA}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nvs-ci-harden.XXXXXX")"
trap '
  docker rm --force nvs-ci-bind >/dev/null 2>&1 || true
  docker rm --force nvs-ci-bad-config >/dev/null 2>&1 || true
  docker rm --force nvs-ci-bad-data >/dev/null 2>&1 || true
  sudo rm -rf "$WORK" >/dev/null 2>&1 || rm -rf "$WORK" >/dev/null 2>&1 || true
' EXIT

normalize_config_modes() {
  local target="$1"
  sudo find "$target" -type d -exec chmod 0750 {} +
  sudo find "$target" -type f -exec chmod 0640 {} +
}

ensure_deploy_owner() {
  if ! id -u nvsdeploy >/dev/null 2>&1; then
    sudo useradd --system --no-create-home --shell /usr/sbin/nologin nvsdeploy
  fi
}

mkdir -p \
  "$WORK/good/config" "$WORK/good/data" \
  "$WORK/bad-config/config" "$WORK/bad-config/data" \
  "$WORK/bad-data/config" "$WORK/bad-data/data"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/good/config/"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/bad-config/config/"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/bad-data/config/"

ensure_deploy_owner

# Exact documented staging ownership: nvsdeploy:10001, dirs 0750, files 0640.
sudo chown -R nvsdeploy:10001 "$WORK/good/config"
normalize_config_modes "$WORK/good/config"
sudo chown -R 10001:10001 "$WORK/good/data"
sudo chmod 0750 "$WORK/good/data"

# Negative config: wrong group (nvsdeploy:nvsdeploy) keeps 0750/0640 — UID 10001 cannot read.
sudo chown -R nvsdeploy:nvsdeploy "$WORK/bad-config/config"
normalize_config_modes "$WORK/bad-config/config"
sudo chown -R 10001:10001 "$WORK/bad-config/data"
sudo chmod 0750 "$WORK/bad-config/data"

# Negative data: readable config, unwritable data directory.
sudo chown -R nvsdeploy:10001 "$WORK/bad-data/config"
normalize_config_modes "$WORK/bad-data/config"
sudo chown -R root:root "$WORK/bad-data/data"
sudo chmod 0750 "$WORK/bad-data/data"

docker run --detach --name nvs-ci-bind --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --mount "type=bind,src=$WORK/good/config,dst=/app/config,readonly" \
  --mount "type=bind,src=$WORK/good/data,dst=/var/lib/nvs" \
  --publish 127.0.0.1:4100:4100 \
  -e "NVS_BUILD_SHA=${BUILD_SHA}" \
  -e "NVS_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -e NVS_RELEASE_VERSION=0.1.0 \
  "$IMAGE"

bash "$ROOT/ops/verify-deployment.sh" http://127.0.0.1:4100 "$BUILD_SHA" 90

identity="$(docker exec nvs-ci-bind node -e 'process.stdout.write(`${process.getuid()}:${process.getgid()}`)')"
[[ "$identity" == "10001:10001" ]] || {
  echo "Expected runtime identity 10001:10001, got ${identity}" >&2
  exit 1
}

docker exec nvs-ci-bind node -e '
const fs = require("fs");
const assert = (cond, msg) => { if (!cond) { console.error(msg); process.exit(1); } };
assert(process.getuid() === 10001 && process.getgid() === 10001, "uid/gid mismatch");
fs.accessSync("/var/lib/nvs", fs.constants.W_OK);
fs.writeFileSync("/var/lib/nvs/ci-persistence-probe", "persisted\n");
for (const target of ["/app/api", "/app/web", "/app/config", "/"]) {
  try {
    fs.writeFileSync(`${target}/.nvs-writable-probe`, "no");
    console.error(`${target} was writable`);
    process.exit(1);
  } catch {
    // expected
  }
}
fs.readFileSync("/app/config/environments/local.example.yaml", "utf8");
'

docker restart nvs-ci-bind
bash "$ROOT/ops/verify-deployment.sh" http://127.0.0.1:4100 "$BUILD_SHA" 90
docker exec nvs-ci-bind test -s /var/lib/nvs/ci-persistence-probe
docker rm --force nvs-ci-bind >/dev/null

wait_for_ready_code() {
  local name="$1"
  local port="$2"
  local expected_code="$3"
  local expected_error="$4"
  local ready_json="$WORK/${name}-ready.json"
  local deadline=$((SECONDS + 90))
  local blocked=false
  : >"$ready_json"
  while (( SECONDS < deadline )); do
    live="$(curl --silent --show-error --max-time 3 "http://127.0.0.1:${port}/api/health/live" 2>/dev/null || true)"
    ready_code="$(
      curl --silent --show-error --max-time 3 \
        -o "$ready_json" \
        -w '%{http_code}' \
        "http://127.0.0.1:${port}/api/health/ready" 2>/dev/null || true
    )"
    if [[ "$live" == *'"status":"ok"'* && "$ready_code" == "$expected_code" ]] &&
      grep -q '"status":"blocked"' "$ready_json" &&
      grep -q "$expected_error" "$ready_json"; then
      blocked=true
      break
    fi
    sleep 2
  done
  [[ "$blocked" == true ]] || {
    echo "${name}: expected readiness ${expected_code}/${expected_error}." >&2
    cat "$ready_json" >&2 || true
    docker logs "$name" >&2 || true
    exit 1
  }
}

docker run --detach --name nvs-ci-bad-config --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --mount "type=bind,src=$WORK/bad-config/config,dst=/app/config,readonly" \
  --mount "type=bind,src=$WORK/bad-config/data,dst=/var/lib/nvs" \
  --publish 127.0.0.1:4101:4100 \
  -e "NVS_BUILD_SHA=${BUILD_SHA}" \
  -e "NVS_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -e NVS_RELEASE_VERSION=0.1.0 \
  "$IMAGE"

wait_for_ready_code nvs-ci-bad-config 4101 503 LOCAL_CONFIGURATION_UNAVAILABLE
docker rm --force nvs-ci-bad-config >/dev/null

docker run --detach --name nvs-ci-bad-data --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --mount "type=bind,src=$WORK/bad-data/config,dst=/app/config,readonly" \
  --mount "type=bind,src=$WORK/bad-data/data,dst=/var/lib/nvs" \
  --publish 127.0.0.1:4102:4100 \
  -e "NVS_BUILD_SHA=${BUILD_SHA}" \
  -e "NVS_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -e NVS_RELEASE_VERSION=0.1.0 \
  "$IMAGE"

wait_for_ready_code nvs-ci-bad-data 4102 503 LOCAL_STORAGE_UNAVAILABLE
docker rm --force nvs-ci-bad-data >/dev/null

echo "Container hardening proofs passed for ${BUILD_SHA}."
