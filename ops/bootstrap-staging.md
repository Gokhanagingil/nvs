# NVS staging bootstrap and operations

This is the one-time contract for a single-node M1-02A staging host. Deployment automation is implemented, but it is not proof that an approved staging server has been configured or deployed.

NVS is independent from NILES/GRC. Use a dedicated deploy user and paths; never stop, recreate, inspect, or otherwise alter NILES/GRC containers while following this runbook.

## Runtime identity

The production image always runs as fixed unprivileged numeric identity `10001:10001`.

Host bind mounts must use those numbers. Do not depend on a deploy username accidentally matching the container user name or an unrelated host UID.

## 1. Host prerequisites

Install a supported Docker Engine and Docker Compose v2 from the operating-system or Docker package channel. Confirm:

```bash
docker version
docker compose version
curl --version
```

Create an unprivileged deployment account with Docker access according to the host's approved administration policy. Ensure numeric group `10001` exists on the host so configuration can be group-readable by the container runtime GID (create `nvsruntime` or an equivalent group at GID `10001` if missing). As an administrator:

```bash
sudo groupadd --gid 10001 nvsruntime 2>/dev/null || true
sudo install -d -m 0750 -o nvsdeploy -g nvsdeploy /opt/nvs
sudo install -d -m 0750 -o nvsdeploy -g nvsdeploy \
  /opt/nvs/ops \
  /opt/nvs/releases
sudo install -d -m 0750 -o nvsdeploy -g 10001 \
  /opt/nvs/config \
  /opt/nvs/config/actors/mappings \
  /opt/nvs/config/actors/profiles \
  /opt/nvs/config/environments \
  /opt/nvs/config/scenarios
sudo install -d -m 0750 -o 10001 -g 10001 /opt/nvs/data
```

Ownership contract:

- `/opt/nvs`, `/opt/nvs/ops`, and `/opt/nvs/releases` are owned by `nvsdeploy:nvsdeploy` for updates;
- `/opt/nvs/config` owner is `nvsdeploy`, numeric group is `10001`, directories are mode `0750`, files are mode `0640`;
- runtime UID/GID `10001:10001` must have read and traverse access to configuration only through GID `10001`, and must never have write permission on configuration;
- do not use world-writable or world-readable configuration modes;
- `/opt/nvs/data` must be owned by `10001:10001` with mode `0750` and is the only writable application path;
- `/opt/nvs/.env` is mode `0600` and owned by the deploy user.

The deploy workflow never uses `sudo` and never overwrites `/opt/nvs/.env`, `/opt/nvs/config`, or `/opt/nvs/data`. Keep SSH access key-only and scoped to this host.

## 2. Server-owned configuration and synthetic actors

Transfer `.env.example` from a reviewed NVS commit to `/opt/nvs/.env`, then set mode `0600`:

```bash
install -m 0600 .env.example /opt/nvs/.env
```

Credential entries are JSON values with exactly `email` and `password`. Use dedicated synthetic non-production users only. Never reuse employee, customer, administrator, or production accounts.

Bootstrap non-secret configuration from reviewed templates, then replace every sanitized value before enabling the target:

1. Copy `scenarios/` into `/opt/nvs/config/scenarios/`.
2. Copy only the `staging-*` actor profiles into `/opt/nvs/config/actors/profiles/`.
3. Copy `actors/mappings/staging-example.yaml` into `/opt/nvs/config/actors/mappings/staging.yaml` (or an equivalent staging environment id mapping).
4. Copy `environments/staging.example.yaml` to `/opt/nvs/config/environments/staging.yaml`.
5. Set the staging NILES `baseUrl` to `http://backend:3002` for internal Docker-network reachability. Do not point NVS at public NILES URLs that return Cloudflare managed-challenge responses to automation.
6. Replace all sanitized tenant UUIDs. Do not leave template tenant IDs unchanged.
7. Enable the environment only after review.

Required tenant assignment for staging actors:

- primary validation tenant UUID: used by requester, service desk, incident manager, and tenant admin;
- separate cross-tenant validation tenant UUID: used only by the cross-tenant agent;
- all five actors are dedicated synthetic non-production users in the approved staging NILES environment.

After writing files, normalize ownership and modes so GID `10001` can read configuration while UID `10001` still cannot write it:

```bash
sudo chown -R nvsdeploy:10001 /opt/nvs/config
sudo find /opt/nvs/config -type d -exec chmod 0750 {} +
sudo find /opt/nvs/config -type f -exec chmod 0640 {} +
sudo chown -R 10001:10001 /opt/nvs/data
sudo chmod 0750 /opt/nvs/data
```

Validate configuration against the transferred image before a cutover attempt:

```bash
export NVS_VALIDATE_IMAGE=nvs:<full-git-sha>
/opt/nvs/ops/validate-staging-config.sh /opt/nvs/config /opt/nvs/data
```

The command must report readiness `ready`. Empty, malformed, inconsistent, or wrongly owned configuration returns typed `BLOCKED` / exit status `2`.

Configuration readiness is local-only: it validates ownership, schema, and file consistency on the host. It does not prove NVS can reach or authenticate against the NILES backend.

## 2a. Internal NILES Docker network

NVS and NILES may share a private Docker network on the same approved staging host. NVS joins that network through Compose; it does not publish NILES backend ports and does not use host networking.

Set this server-owned value in `/opt/nvs/.env`:

```bash
NVS_NILES_DOCKER_NETWORK=grc-platform_grc-staging-network
```

The staging environment `baseUrl` must be `http://backend:3002`, matching the NILES backend Docker alias on that network.

Before cutover, confirm the shared network and backend alias:

```bash
docker network inspect grc-platform_grc-staging-network
```

Verify the NILES backend service lists the alias `backend`. A temporary container on the same network must reach `http://backend:3002/health/live` with HTTP 200.

Public NILES endpoints (`https://niles-grc.com`, `https://api.niles-grc.com`) remain Cloudflare-protected. Do not weaken managed-challenge protection merely to support NVS automation. The NILES backend must not be published on a broad or public host interface.

Authentication preflight is the explicit connectivity and authentication acceptance step after deployment. Run it only after NVS is healthy and the internal `baseUrl` is configured.

## 3. Pinned SSH trust and GitHub environment

Create a GitHub environment named `staging`. Configure these environment secrets:

- `NVS_STAGING_SSH_HOST`
- `NVS_STAGING_SSH_USER`
- `NVS_STAGING_SSH_KEY_B64` — base64 of the dedicated private key
- `NVS_STAGING_SSH_KNOWN_HOSTS` — the pre-approved host-key line

An infrastructure administrator must obtain the host's public key through a trusted console or inventory channel and verify its fingerprint. `ssh-keyscan` may produce a candidate line, but never trust an unverified scan as the only proof:

```bash
ssh-keyscan -t ed25519 nvs-staging.example.invalid > candidate-known-hosts
ssh-keygen -lf candidate-known-hosts
```

Compare that fingerprint through the trusted channel before storing the complete line in `NVS_STAGING_SSH_KNOWN_HOSTS`.

Optional GitHub environment variables:

- `NVS_STAGING_DEPLOY_PATH` (default `/opt/nvs`)
- `NVS_STAGING_HOST_PORT` (default `4100`)
- `NVS_STAGING_HEALTH_URL` (default SSH-local `http://127.0.0.1:<port>`)

The workflow validates these values before use.

## 4. Control-plane exposure

Compose binds NVS to host loopback only (`127.0.0.1:<port>`). Keep that default.

External access requires either:

- an SSH tunnel restricted to authorized operators; or
- an approved TLS reverse proxy that also enforces authentication and authorization for the NVS control plane.

TLS alone is not sufficient. Do not expose the unauthenticated NVS control plane to a public or broad internal network. Permit SSH only from the GitHub-hosted runner strategy approved by operations and from the operator network that needs tunnel access.

## 5. First and subsequent deployments

From an authorized workstation:

```bash
gh workflow run deploy-staging.yml --ref main -f ref=main
```

The workflow resolves the ref to a full commit SHA, runs `pnpm run ci`, builds one labeled image, saves that exact image archive with a SHA-256 digest, transfers both, verifies the digest on the server before `docker load`, and deploys only the `nvs` Compose service. Deployment succeeds only when liveness, readiness, and `/api/version` report the requested SHA.

Before replacing the active container, the deploy script records the running container's immutable image ID and tags a unique `nvs-rollback:*` reference. Redeploying the same Git SHA cannot erase that rollback reference. On failure the previous image ID is restored and re-verified. Successful deploys prune older rollback tags while retaining the newest five (`NVS_ROLLBACK_RETENTION`, max 20).

Inspect from the host:

```bash
curl --fail http://127.0.0.1:4100/api/health/live
curl --fail http://127.0.0.1:4100/api/health/ready
curl --fail http://127.0.0.1:4100/api/version
docker ps --filter name=^/nvs$
docker logs --tail 100 nvs
```

Do not paste logs into tickets until reviewed for identifiers. NVS intentionally never logs credentials or bearer material.

## 6. Failure and rollback

Failed deployment health automatically restores and verifies the previously active immutable image ID when available. The workflow then remains failed.

For a reviewed manual rollback to a still-local exact SHA tag:

```bash
docker image ls nvs --no-trunc
/opt/nvs/ops/rollback-staging.sh <full-previous-sha>
```

Prefer the automatic immutable image-ID rollback created by `deploy-staging.sh`. Manual SHA rollback refuses a tag whose OCI revision label differs from the requested SHA. If neither a rollback tag nor previous image remains, rerun the deployment workflow for that Git commit to transfer the exact archive again. Do not use `docker compose down`.

## 7. Evidence backup and credential updates

`/opt/nvs/data` is owned by `10001:10001` with mode `0750`, so an unprivileged deploy user cannot read it directly. Create an application-consistent evidence backup during an approved maintenance window with a narrowly privileged `sudo tar` flow:

```bash
backup="/opt/nvs/releases/nvs-data-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker stop nvs
sudo tar --create --gzip --file "$backup" --directory /opt/nvs data
sudo chown nvsdeploy:nvsdeploy "$backup"
sudo chmod 0600 "$backup"
docker start nvs
/opt/nvs/ops/verify-deployment.sh http://127.0.0.1:4100 \
  "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' nvs)" \
  120
```

After creation the backup archive must remain deploy-user owned and mode `0600`. Store and test backups according to the organization's retention policy. Backups may contain validation evidence and must stay access-controlled.

To add or rotate a synthetic actor later, update only the corresponding server-side `.env` JSON value, retain mode `0600`, and recreate the NVS service using the currently active exact image. Never commit the populated file or print it during troubleshooting. Authentication preflight is an explicit operator action and remains denied for production-classified environments.
