# Cursor/Codex Prompt — M1-02A Deployable Foundation and Actor Sessions

Use this prompt after the kickoff documentation PR is merged.

**Primary repository:** `Gokhanagingil/nvs` — writable  
**Reference repository:** `Gokhanagingil/grc` — strictly read-only  
**Governing issue:** `Gokhanagingil/nvs#5`  
**Parent milestone:** `Gokhanagingil/nvs#2`  
**Recommended model:** GPT-5.6 Sol, Extra High reasoning  
**Execution:** one coherent local agent; do not use parallel agents for the initial architecture pass

---

## Prompt to give the implementation agent

You are implementing **M1-02A — Deployable Foundation and Actor Sessions** for NVS.

The previous M1-01 walking skeleton is merged. This task makes NVS continuously validated, production-packaged, manually deployable to staging, and ready to authenticate dedicated synthetic NILES actors independently. It does **not** execute Incident mutations yet.

Work autonomously through inspection, implementation, validation, focused commits, push, and creation of a draft pull request. Do not wait for approval on ordinary reversible engineering choices. Stop and ask only when a safe implementation requires a material Product Owner decision.

## 1. Repository boundaries

The workspace contains two independent repositories:

- `nvs` — writable primary implementation repository.
- `grc` — strictly read-only NILES reference repository.

All files, dependency changes, branches, commits, pushes, workflow changes, Docker files, and pull requests belong only to `nvs`.

Do not create, modify, delete, rename, format, generate files, install dependencies, switch branches, stash, reset, stage, commit, or push anything in `grc`.

Use `grc` only for read operations such as search, file inspection, `git log`, `git show`, `git rev-parse`, and `git status`.

Do not mutate any live NILES environment. Do not call Incident, SLA, user, tenant, fixture, or other mutating endpoints. Authentication preflight may call the confirmed login endpoint only when explicitly invoked by an operator and runtime secrets are configured.

## 2. Start-up procedure

Before editing:

1. Verify both repositories are clean.
2. In `nvs` only:
   - fetch `origin`;
   - switch to `main`;
   - pull with `--ff-only`;
   - create and switch to:

```text
agent/m1-02a-deployable-foundation
```

3. Read completely:
   - `AGENTS.md`
   - `PROJECT_CHARTER.md`
   - `docs/IMPLEMENTATION_AUTHORIZATION_2026-07-14.md`
   - `docs/DECISIONS.md`
   - `docs/adr/ADR-0001-M1-WALKING-SKELETON-STACK.md`
   - `docs/discovery/NILES_CONTRACT_FINDINGS_M1.md`
   - `docs/roadmap/M1_PRODUCT_DELIVERY_PLAN_2026-07-14.md`
   - this prompt
   - GitHub issues #2 and #5 when accessible

4. Inspect the merged M1-01 implementation and tests before changing architecture.
5. Inspect the current default branch of `grc`, especially:
   - `.github/workflows/deploy-staging.yml`
   - `docs/STAGING-DEPLOYMENT-PIPELINE.md`
   - `docs/operations/NILES-INSTALLATION-DEPLOYMENT-OPERATIONS-GUIDE.md`
   - authentication controller/service/DTO/JWT behavior;
   - tenant guard and correlation-ID handling.

Record the inspected `grc` SHA in the M1-02A documentation. Reuse lessons, not files or secrets. Do not blindly copy the large GRC deploy workflow; build the smallest reliable NVS workflow that satisfies this prompt.

First return a concise implementation plan, then proceed without waiting for approval.

## 3. Business outcome

At the end of this PR:

- NVS is packaged as one immutable production container image;
- the image serves the built React console and Fastify API on one port;
- PRs and `main` validate code plus the production container build;
- a manual GitHub Actions workflow deploys an exact image to staging, verifies it, and rolls back on failure;
- an operator can see whether configured synthetic NILES actors are missing, configured, or independently authenticated;
- passwords and session material never enter Git, browser responses, logs, or evidence artifacts;
- no NILES business record is mutated.

## 4. Binding product decisions

### 4.1 Synthetic actors only

Use dedicated synthetic NVS test identities in approved non-production NILES environments. Never use real employee, customer, or production identities.

### 4.2 Independent real sessions

Each semantic actor authenticates through the real confirmed NILES login contract and receives an independent session. Do not use impersonation as the primary mechanism. Do not repeatedly logout/login between steps. Keep actor sessions isolated in memory only for the lifetime of the authentication preflight or future run.

### 4.3 Production boundary

In M1-02A:

- production may receive the existing explicitly invoked read-only health probe;
- authentication preflight is forbidden for `kind: production`;
- no mutating run is possible;
- no testability control is exposed to production.

### 4.4 Deployment boundary

Deployment begins as manual `workflow_dispatch`. Do not auto-deploy every push to `main` yet. The workflow must deploy an immutable exact-SHA image, not run `git pull` and rebuild source on the server.

## 5. Packaging architecture

Create one production image for NVS.

### Required behavior

- Multi-stage Docker build using the repository-pinned Node 24 release.
- Install from the lockfile with Corepack/pnpm.
- Run the existing full quality/build prerequisites outside or before the final runtime stage.
- Build the React application and Fastify API.
- Serve the built SPA and `/api` from the same Fastify process and port.
- Support SPA route fallback without intercepting `/api` routes.
- Runtime image contains only required production files/dependencies.
- Run as a non-root user.
- Add an init/signal strategy and graceful Fastify shutdown.
- Bind to `0.0.0.0` inside the container while preserving secure local defaults outside containers.
- Do not write into the image filesystem at runtime except approved temporary locations.
- Use configurable paths such as:
  - `NVS_DATA_DIR` for artifacts/run bundles;
  - `NVS_CONFIG_DIR` for versioned or mounted non-secret definitions;
  - `NVS_API_HOST` and `NVS_API_PORT`;
  - `NVS_BUILD_SHA`, `NVS_BUILD_TIMESTAMP`, and `NVS_RELEASE_VERSION`.
- Preserve compatibility with local non-container development.

Create at least:

```text
Dockerfile
.dockerignore
docker-compose.staging.yml
ops/
  bootstrap-staging.md
  verify-deployment.sh
```

A separate frontend container is not needed in this slice. Prefer the single-runtime design unless inspection proves a blocking technical reason; document any departure in an ADR before implementing it.

## 6. NVS operational endpoints

Add or evolve endpoints with versioned responses:

```text
GET /api/health/live
GET /api/health/ready
GET /api/version
```

Keep `/api/health` as a compatibility alias if useful.

Requirements:

- liveness confirms the process is alive;
- readiness confirms required local configuration/storage is usable without calling live NILES;
- version returns build SHA, timestamp, release version, Node version, and contract version where known;
- no absolute local paths or secrets;
- container healthcheck uses a bounded local endpoint;
- deployment verification confirms the running SHA equals the deployed SHA.

## 7. Configuration and secret-provider boundary

### 7.1 Versioned non-secret actor contract

Add a versioned runtime-validated contract such as:

```text
nvs.actor-profile/v1
```

It should express only non-secret information:

- stable actor/profile ID;
- display name;
- semantic persona;
- environment ID or environment binding;
- tenant ID reference or non-secret tenant UUID where explicitly approved;
- symbolic credential reference;
- expected domain/role/capability notes;
- enabled state;
- whether MFA is expected or unsupported for automated use;
- provenance/review metadata where useful.

Do not put email, username, password, access token, refresh token, cookie, MFA seed, private key, or Authorization value in committed actor files unless an email-like login identifier is explicitly approved as non-secret. Prefer resolving all login identifiers through the secret provider so committed examples remain sanitized.

Support environment-to-actor mapping for at least these semantic actors:

```text
requester
service-desk-agent
incident-manager
tenant-admin
cross-tenant-agent
```

The unauthenticated actor has no credential profile.

Add sanitized example actor definitions. Real local overrides must be ignored by Git.

### 7.2 Secret-provider port

Create a narrow replaceable secret-provider interface. Implement an environment-variable provider for M1-02A.

Choose and document a deterministic naming convention. A valid design may use one JSON value per symbolic credential reference or separate username/password variables, but it must:

- avoid enumerating or returning secret values;
- distinguish MISSING from CONFIGURED;
- validate input shape;
- never log raw values;
- never persist secrets;
- never return secrets to the browser;
- allow future replacement by a real secret manager without changing domain contracts.

Do not add a hosted secret-manager dependency in this slice.

## 8. NILES authentication adapter and actor sessions

Add an authenticated NILES adapter boundary without implementing Incident actions.

### Confirmed login contract

Verify against `grc` current source, then support the confirmed contract:

```text
POST /auth/login
{ email, password }
```

Handle both direct and globally wrapped successful responses where current NILES behavior requires it.

### Required outcomes

For each configured actor:

- resolve credentials from the secret provider;
- authenticate independently;
- validate that an access token and user identity are present;
- obtain/validate the expected tenant context where available;
- create an isolated in-memory actor session;
- do not share tokens between actor IDs;
- do not persist or expose token values;
- destroy the session cache after the preflight completes;
- attach a generated correlation ID to safe follow-up verification calls when a verified non-mutating route is used.

No browser session is required yet. This is API authentication only.

### MFA and error handling

The following produce typed `BLOCKED` results rather than PASS or generic failure:

- missing secret reference;
- incomplete credential pair;
- login denied;
- MFA challenge or `mfaRequired` response;
- malformed login response;
- missing access token;
- tenant mismatch;
- login timeout/network failure;
- production environment;
- disabled environment/profile.

Never include the login email/identifier in a public error if it is treated as confidential by the provider. Redact transport details.

## 9. Authentication preflight use case

Create a use case that checks actor readiness without mutating NILES.

Suggested API:

```text
GET  /api/environments/:id/actors
POST /api/environments/:id/auth-preflight
```

Exact naming may differ if documented consistently.

The list response should report only safe states such as:

```text
NOT_CONFIGURED
CONFIGURED
DISABLED
```

The preflight result may report:

```text
PASS
BLOCKED
```

per actor, with safe metadata:

- actor/profile ID;
- persona;
- credential configuration state;
- authentication state;
- expected/observed tenant IDs when safe;
- user ID when safe and useful;
- duration;
- typed error category/code;
- correlation ID;
- timestamp.

Do not return access tokens, cookies, password fields, MFA seeds, Authorization headers, or raw login payloads.

Authentication preflight results are operational diagnostics, not release-gate PASS. Mark them non-gate-eligible.

Do not persist session material. Persisting a sanitized preflight summary is optional; if implemented, use the existing immutable evidence principles and clearly separate it from scenario execution.

## 10. Web console changes

Extend the existing Environments experience rather than redesigning the application.

For each environment show:

- NVS environment kind and enabled state;
- read-only probe status;
- actor profile count;
- actor configuration readiness;
- a clearly labeled **Run authentication preflight** action for non-production environments;
- per-actor PASS/BLOCKED result with safe error codes;
- a clear statement that no Incident records are created in M1-02A;
- NVS running build SHA/version in the shell or diagnostics area.

Requirements:

- production environments must not offer an enabled auth-preflight action;
- loading, empty, disabled, missing-secret, MFA, timeout, and malformed-response states are visible;
- no raw untrusted HTML;
- maintain accessible labels and keyboard behavior;
- add stable selectors only when semantic locators are insufficient.

## 11. CI evolution

Preserve `corepack pnpm run ci` as the main application quality command.

Improve `.github/workflows/ci.yml`:

- add workflow-level or job-level concurrency; cancel superseded PR CI safely;
- keep PR and `main` triggers;
- pin third-party actions to immutable commit SHAs, not floating major tags;
- preserve install, formatting, lint, strict TypeScript, Vitest, builds, and Chromium smoke;
- validate the production Docker image build on PRs and `main`;
- verify the container starts and its local liveness/readiness/version endpoints work;
- verify the reported build SHA matches the test SHA;
- upload Playwright traces/screenshots and useful test reports when the workflow fails;
- do not call live NILES;
- do not require staging secrets for CI;
- use appropriate timeouts and minimal permissions.

Do not add automatic deployment to the CI workflow.

## 12. Manual staging deployment workflow

Create:

```text
.github/workflows/deploy-staging.yml
```

### Trigger and safety

- `workflow_dispatch` only in M1-02A.
- Accept an optional Git ref or default to `main`; resolve and display the exact SHA.
- Refuse uncommitted or ambiguous source; deploy only repository commits.
- Use GitHub environment `staging`.
- Use deployment concurrency with `cancel-in-progress: false`.
- Apply explicit job timeouts and minimal permissions.
- Pin all third-party actions to commit SHAs.

### Build

- Checkout the exact ref/SHA.
- Run or depend on the required quality gate.
- Build one immutable image tagged with the full Git SHA.
- Do not put secrets in image layers or build args.
- Export the image as a tar archive and transfer that exact archive to the server. Do not rebuild source on the server.
- Record safe image metadata and digest when available.

### Required staging secrets

Use distinct NVS names, not GRC secret names. At minimum:

```text
NVS_STAGING_SSH_HOST
NVS_STAGING_SSH_USER
NVS_STAGING_SSH_KEY_B64
NVS_STAGING_SSH_KNOWN_HOSTS
```

`NVS_STAGING_SSH_KNOWN_HOSTS` must contain a pre-approved pinned host-key entry. Do not trust an unverified runtime `ssh-keyscan` result as the only host verification.

Optional repository/environment variables may include:

```text
NVS_STAGING_DEPLOY_PATH       default /opt/nvs
NVS_STAGING_HOST_PORT         default 4100
NVS_STAGING_HEALTH_URL        operator-approved external or SSH-local URL
```

Validate and sanitize host, user, path, port, and URL values. Never echo private keys or secrets.

### Server contract

The server must retain its own non-versioned configuration:

```text
/opt/nvs/.env
/opt/nvs/config/
/opt/nvs/data/
```

The deployment workflow must not overwrite `/opt/nvs/.env` or real actor credential configuration.

The compose deployment should:

- load the transferred exact-SHA image;
- keep persistent NVS data/config mounts;
- set build SHA/timestamp/version safely;
- use a deterministic container name and restart policy;
- expose the configured host port;
- start/recreate only NVS resources;
- leave NILES/GRC containers untouched.

### Verification and rollback

Before replacing the active container, record the previously active image tag/digest when available.

After deployment:

- poll NVS liveness/readiness with a bounded deadline;
- query NVS version;
- assert running build SHA equals the requested SHA;
- optionally run one compile-only NVS smoke through the local API, but do not call NILES authentication unless explicitly requested and configured;
- mark deployment successful only after all required checks pass.

On failure:

- collect safe container status and bounded logs with redaction;
- restore the previous image/compose state when available;
- verify rollback health;
- fail the workflow clearly;
- never print actor credentials or tokens.

Add a safe manual rollback input or separate documented rollback procedure if this improves reliability without excessive scope.

## 13. Staging bootstrap and operator runbook

Document exact one-time operator steps without embedding real infrastructure secrets.

The runbook must cover:

- Docker/Compose prerequisites;
- deploy user and `/opt/nvs` directory ownership;
- creating the server-side `.env` from a sanitized example;
- persistent config/data directories;
- GitHub environment/secrets setup;
- generation and verification of a pinned known-hosts entry;
- port/firewall/reverse-proxy considerations;
- first manual deployment;
- health/version checks;
- logs;
- rollback;
- backup of NVS evidence data;
- adding synthetic actor credentials later without committing them;
- explicit warning not to reuse real user accounts.

A sample Nginx reverse-proxy configuration may be provided, but TLS/domain provisioning is not required in this PR.

## 14. Architecture records

Create an ADR such as:

```text
docs/adr/ADR-0002-DEPLOYMENT-AND-ACTOR-SESSION-FOUNDATION.md
```

Record:

- single-container decision;
- filesystem persistence and mounted paths;
- exact-image deployment strategy;
- manual workflow decision;
- actor/session and secret-provider boundaries;
- independent real login and no-impersonation decision;
- production auth-preflight denial;
- rollback and operational limitations;
- deferred choices such as registry, Kubernetes, hosted secret manager, distributed workers, and public production exposure.

Update README and relevant decision/operations docs where needed. Do not rewrite historical decisions inaccurately.

## 15. Tests

Add deterministic tests for at least:

### Contracts and secrets

- valid sanitized actor profile and environment mapping;
- invalid/unknown actor schema version;
- secret-bearing committed fields rejected recursively;
- missing credential reference;
- incomplete provider value;
- provider never enumerates or returns secret values through public status APIs.

### Authentication adapter

- two or more actors login independently and receive different token/session objects;
- direct and wrapped NILES login responses;
- denied login;
- MFA-required response;
- malformed response;
- missing token;
- timeout/network failure;
- expected tenant success and mismatch;
- no token/password in JSON serialization, logs, errors, or persisted files;
- session cache destroyed after preflight.

### Policy

- production auth preflight is blocked;
- disabled environment/profile is blocked or skipped with an explicit state;
- existing read-only production probe policy remains intact;
- no Incident endpoint is called by M1-02A.

### API/UI

- actor list exposes safe configuration states only;
- auth preflight safe result envelope;
- Environments UI shows actor readiness and typed BLOCKED states;
- production button disabled/absent;
- Playwright journey uses a deterministic mock NILES auth server and confirms no secret appears in rendered content.

### Container and deployment

- production image builds;
- container starts as non-root;
- UI and API work on one port;
- health/readiness/version work;
- build SHA is visible and correct;
- data persists through a container restart using a mounted test volume;
- deployment shell logic has lint/static tests where practical;
- rollback/failed-health behavior is testable through scripts or a deterministic harness where feasible.

No required CI test may contact live NILES or the public internet after dependencies/images are acquired.

## 16. Scope controls and non-goals

Do not implement in this PR:

- Incident create/update/assign/hold/resume/resolve/close calls;
- SLA runtime execution;
- fixture or cleanup mutation;
- user or tenant provisioning;
- impersonation;
- NILES Playwright automation;
- a database;
- distributed workers/queues;
- Kubernetes;
- public customer tenancy;
- billing or commercial packaging;
- hosted AI provider integration;
- automatic deployment on every `main` push;
- changes to `grc`.

Create follow-up issues or an explicit backlog section instead of expanding scope.

## 17. Required validation

Run and record exact results for:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
```

Also run:

- clean production Docker build;
- local container smoke for UI/API/health/readiness/version;
- mounted-volume persistence smoke;
- mock multi-actor auth preflight;
- secret scan over final diff and generated artifacts;
- workflow syntax/static validation available in the repository/tooling;
- full diff inspection;
- `git status --short` in `grc`.

A real staging deployment is optional during PR implementation if the required environment secrets/server are not yet configured. The workflow, scripts, and deterministic deployment/rollback tests must still be complete. Clearly distinguish **workflow implemented** from **staging deployment proven**.

## 18. Commit and pull-request requirements

Use focused commits. A reasonable sequence:

1. container/runtime serving and operational endpoints;
2. actor contracts, secret provider, and session/auth adapter;
3. auth preflight API and UI;
4. CI/container validation;
5. staging deployment workflow and ops scripts;
6. tests, ADR, runbook, and documentation.

Do not collapse unrelated changes into one opaque commit.

Push and open a **draft PR** targeting `main` with title similar to:

```text
feat: add deployable NVS foundation and actor preflight
```

Use `Refs #5` and `Refs #2`; do not close issue #2. Issue #5 may be closed only when every acceptance criterion is met, including an honest statement about whether deployment was actually proven on the approved server.

The PR body must include:

- business outcome;
- architecture and ADR summary;
- container design;
- actor/session and secret boundaries;
- CI changes;
- staging workflow, required secrets/variables, and bootstrap steps;
- exact NILES contracts and inspected `grc` SHA;
- test/build/container results;
- deployment proof status: IMPLEMENTED_ONLY or PROVEN_ON_STAGING;
- safe UI screenshots;
- security notes;
- known limitations and M1-02B prerequisites;
- confirmation that `grc` stayed clean.

Do not merge the PR.

## 19. Final response

After the draft PR is open, report:

- branch and PR URL;
- commit list;
- concise deployed architecture;
- what works end to end;
- CI/test/container results;
- deployment workflow status and required operator setup;
- actor/session behavior and secret guarantees;
- exact NILES facts confirmed;
- blockers or missing runtime configuration;
- whether staging deployment was actually executed;
- `grc` final clean status;
- M1-02B follow-up work;
- any material Product Owner decision required.

Do not claim that Incident, SLA, authorization, tenant isolation, or NILES release readiness passed. M1-02A proves deployability and independent actor authentication readiness only.
