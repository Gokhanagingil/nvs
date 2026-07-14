# ADR-0002 — Deployment and Actor Session Foundation

> **Status:** Accepted for M1-02A
> **Date:** 2026-07-14
> **Scope:** Deployable NVS runtime and authentication readiness only

## Context

M1-02A must package NVS as an independently deployable service, continuously validate the production artifact, and establish independent authentication sessions for dedicated synthetic NILES actors. It must not mutate an Incident, SLA, tenant, user, fixture, or other NILES business record.

The NILES reference repository was inspected read-only at commit `33af470e10fa753b79e092d9a99ef4f570854b10`. The confirmed login boundary is `POST /auth/login` with `{ email, password }`; successful responses may be direct or wrapped in `{ success, data }`, may return an MFA branch, and bearer-authenticated tenant requests additionally require a UUID `x-tenant-id`. These facts are adapter inputs, not permission or release-readiness proof.

## Decision

### Runtime and persistence

- Build one immutable, multi-stage Node 24 container.
- Serve the compiled React SPA and versioned `/api` routes from one Fastify process on port 4100.
- Run as fixed unprivileged numeric identity `10001:10001` with Tini, a read-only root filesystem, bounded `/tmp` tmpfs, dropped Linux capabilities, a health check, and graceful signal handling.
- Keep application code and static assets root-owned and non-writable. Only `/var/lib/nvs` is writable by the runtime identity; `/app/config` is readable and bind-mounted read-only in Compose.
- Keep filesystem repositories behind existing ports. This remains a single-node persistence model.

### Deployment

- Use manual `workflow_dispatch`; do not deploy automatically from `main`.
- Resolve the requested Git ref to one full commit SHA, pass that SHA into image metadata, transfer that exact saved image archive with a SHA-256 digest, verify the digest before load, then load it on staging. Never rebuild source on the server.
- Keep `/opt/nvs/.env`, `/opt/nvs/config`, and `/opt/nvs/data` server-owned and non-versioned. Configuration is `nvsdeploy:10001` (`0750`/`0640`) so GID `10001` can read it without write access; data is `10001:10001` (`0750`). Deployment replaces only NVS image/Compose/operations resources and never touches NILES or GRC containers.
- Before replacement, capture the running container's immutable image ID under a unique temporary rollback tag. Verify bounded liveness, readiness, and reported build SHA. If replacement fails, restore and verify that immutable image ID. Successful deploys retain a bounded set of rollback tags.

### Actors, secrets, and sessions

- Version only sanitized actor profiles and environment mappings. A profile names a symbolic `credentialRef`; it never carries a login identifier, password, token, cookie, or authorization header.
- Resolve each credential through a `SecretProvider`. M1-02A supplies an environment-variable provider; hosted secret managers remain replaceable future implementations.
- Authenticate each synthetic actor through the normal NILES login endpoint. Do not use impersonation or a shared service session.
- Keep credentials and resulting bearer sessions in private in-memory fields for the duration of one preflight. Destroy each credential and session independently on success or failure.
- Return only configuration state, authenticated/blocking state, safe typed errors, and non-secret actor metadata to the API and browser.
- Deny authentication preflight for every production-classified environment before secret resolution or network access.
- Require NILES login `user.id` to be a UUID; missing or non-UUID identities are typed `LOGIN_RESPONSE_MALFORMED`.
- Treat login `passwordChangeRequired === true` or user `mustChangePassword === true` as `BLOCKED` / `PASSWORD_CHANGE_REQUIRED` without creating a usable actor session.
- Treat MFA, invalid credentials, malformed responses, timeouts, network failures, and tenant mismatch as `BLOCKED`, never as product `FAIL`.
- Local readiness validates usable configuration: readable trees, at least one valid environment and scenario, required actor mappings/profiles for enabled non-production environments, contract parsing, and writable persistent storage.

## Consequences

### Positive

- CI validates the same one-port production topology deployed to staging.
- Build identity is observable and can be compared to the requested commit.
- Operator-owned configuration and evidence survive image replacement and container restart.
- Actor readiness is visible without exposing credential or session material.
- Authentication behavior is deterministic in CI through a local mock and does not depend on live NILES.

### Costs and limitations

- Filesystem persistence and in-memory sessions support one NVS node; there is no distributed worker or durable session store.
- A server must be bootstrapped with Docker/Compose, pinned SSH trust, non-versioned configuration, and synthetic credentials before deployment can be proven.
- The environment-variable secret provider is an initial boundary, not the preferred long-term production secret store.
- Rollback depends on the previously active labeled image remaining in the server's local Docker store.
- M1-02A proves deployability and authentication readiness only. It does not prove Incident/SLA behavior, authorization, tenant isolation, cleanup, or NILES release readiness.

## Deferred

- Image registry publication and signature/attestation.
- Kubernetes or another scheduler.
- Hosted secret-manager implementation and credential rotation automation.
- Distributed workers, database persistence, public production exposure, and managed TLS.
- NILES business-action execution, deterministic fixture controls, correlated event evidence, and cleanup verification for M1-02B.
