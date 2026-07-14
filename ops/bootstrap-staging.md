# NVS staging bootstrap and operations

This is the one-time contract for a single-node M1-02A staging host. Deployment automation is implemented, but it is not proof that an approved staging server has been configured or deployed.

NVS is independent from NILES/GRC. Use a dedicated deploy user and paths; never stop, recreate, inspect, or otherwise alter NILES/GRC containers while following this runbook.

## 1. Host prerequisites

Install a supported Docker Engine and Docker Compose v2 from the operating-system or Docker package channel. Confirm:

```bash
docker version
docker compose version
curl --version
```

Create an unprivileged deployment account with Docker access according to the host's approved administration policy. As an administrator:

```bash
sudo install -d -m 0750 -o nvsdeploy -g nvsdeploy /opt/nvs
sudo install -d -m 0750 -o nvsdeploy -g nvsdeploy \
  /opt/nvs/config/actors/mappings \
  /opt/nvs/config/actors/profiles \
  /opt/nvs/config/environments \
  /opt/nvs/config/scenarios \
  /opt/nvs/data \
  /opt/nvs/ops \
  /opt/nvs/releases
```

The deploy account must own `/opt/nvs`; no workflow step uses `sudo`. Keep SSH access key-only and scoped to this host.

## 2. Server-owned configuration

Transfer `.env.example` from a reviewed NVS commit to `/opt/nvs/.env`, then set mode `0600`. Populate it only on the server or through an approved secret-delivery process:

```bash
install -m 0600 .env.example /opt/nvs/.env
```

The credential entries are JSON values with exactly `email` and `password`, for example:

```dotenv
NVS_CREDENTIAL_NILES_DOT_STAGING_DOT_REQUESTER={"email":"synthetic-requester@approved.invalid","password":"replace-through-approved-secret-process"}
```

Do not copy that illustrative value. Use separate, dedicated synthetic users in the approved non-production tenant. Never reuse employee, customer, administrator, or production accounts. The workflow does not read or overwrite `/opt/nvs/.env`.

Bootstrap non-secret reviewed configuration out of band:

- copy `scenarios/` into `/opt/nvs/config/scenarios/`;
- copy only the `staging-*` actor profiles into `/opt/nvs/config/actors/profiles/`;
- copy `actors/mappings/staging-example.yaml` into `/opt/nvs/config/actors/mappings/`;
- copy `environments/staging.example.yaml` to `/opt/nvs/config/environments/staging.yaml`;
- replace the `.invalid` base URL with the operator-approved staging NILES URL and enable it only after review.

Actor YAML stores symbolic credential references, never credential values. Restrict config writes to the deploy/operations group. The deployment workflow retains this entire directory.

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

## 4. Network exposure

Compose binds NVS to host loopback by default. Permit SSH from the GitHub-hosted runner strategy approved by operations. For external access, place an approved TLS reverse proxy in front of `127.0.0.1:4100`; do not open the container port publicly merely for convenience.

## 5. First and subsequent deployments

From an authorized workstation:

```bash
gh workflow run deploy-staging.yml --ref main -f ref=main
```

The workflow resolves the ref to a full commit SHA, runs `pnpm run ci`, builds one labeled image, saves and transfers that exact image archive, and deploys only the `nvs` Compose service. It succeeds only when liveness, readiness, and `/api/version` report the requested SHA.

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

Failed deployment health automatically triggers restoration and verification of the previously active labeled image when available. The workflow then remains failed.

For a reviewed manual rollback, choose a full SHA already present in the local Docker image store:

```bash
docker image ls nvs --no-trunc
/opt/nvs/ops/rollback-staging.sh <full-previous-sha>
```

The script refuses a tag whose OCI revision label differs from the requested SHA and verifies health/version after replacement. Do not retag an unverified image. If the previous image has been pruned, rerun the deployment workflow for that Git commit to transfer the exact archive again.

## 7. Evidence backup and credential updates

Create an application-consistent evidence backup during an approved maintenance window:

```bash
docker stop nvs
tar --create --gzip --file "/opt/nvs-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  --directory /opt/nvs data
docker start nvs
/opt/nvs/ops/verify-deployment.sh http://127.0.0.1:4100 \
  "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' nvs)" \
  120
```

Store and test backups according to the organization's retention policy. Backups may contain validation evidence and must be access-controlled.

To add or rotate a synthetic actor later, update only the corresponding server-side `.env` JSON value, retain mode `0600`, and recreate the NVS service using the currently active exact image. Never commit the populated file or print it during troubleshooting. Authentication preflight is an explicit operator action and remains denied for production-classified environments.
