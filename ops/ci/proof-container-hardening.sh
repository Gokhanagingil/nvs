#!/usr/bin/env bash
set -euo pipefail

BUILD_SHA="${1:?BUILD_SHA is required}"
IMAGE="nvs:${BUILD_SHA}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nvs-ci-harden.XXXXXX")"
trap 'rm -rf "$WORK"; docker rm --force nvs-ci-bind >/dev/null 2>&1 || true; docker rm --force nvs-ci-bad-bind >/dev/null 2>&1 || true' EXIT

mkdir -p "$WORK/good/config" "$WORK/good/data" "$WORK/bad/config" "$WORK/bad/data"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/good/config/"
cp -a "$ROOT/actors" "$ROOT/environments" "$ROOT/scenarios" "$WORK/bad/config/"
sudo chown -R 10001:10001 "$WORK/good/data"
sudo chown -R root:root "$WORK/bad/data"
sudo chmod 0750 "$WORK/good/data" "$WORK/bad/data"
sudo chmod -R a+rX "$WORK/good/config" "$WORK/bad/config"

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

docker run --detach --name nvs-ci-bad-bind --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --mount "type=bind,src=$WORK/bad/config,dst=/app/config,readonly" \
  --mount "type=bind,src=$WORK/bad/data,dst=/var/lib/nvs" \
  --publish 127.0.0.1:4101:4100 \
  -e "NVS_BUILD_SHA=${BUILD_SHA}" \
  -e "NVS_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -e NVS_RELEASE_VERSION=0.1.0 \
  "$IMAGE"

deadline=$((SECONDS + 60))
blocked=false
while (( SECONDS < deadline )); do
  live="$(curl --fail --silent --show-error --max-time 3 http://127.0.0.1:4101/api/health/live || true)"
  ready_code="$(curl --silent --show-error --max-time 3 -o "$WORK/ready.json" -w '%{http_code}' http://127.0.0.1:4101/api/health/ready || true)"
  if [[ "$live" == *'"status":"ok"'* && "$ready_code" == "503" ]]; then
    if grep -q '"status":"blocked"' "$WORK/ready.json" &&
      grep -q 'LOCAL_STORAGE_UNAVAILABLE\|LOCAL_CONFIGURATION' "$WORK/ready.json"; then
      blocked=true
      break
    fi
  fi
  sleep 2
done

[[ "$blocked" == true ]] || {
  echo "Incorrect ownership did not produce readiness BLOCKED." >&2
  cat "$WORK/ready.json" >&2 || true
  exit 1
}

echo "Container hardening proofs passed for ${BUILD_SHA}."
