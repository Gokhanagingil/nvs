# NVS — NILES Validation Suite

NVS is an external, evidence-producing validation system for NILES. M1-02A packages the walking skeleton for deployment and adds safe independent synthetic-actor authentication readiness.

> **Current slice:** M1-02A deployable foundation and actor sessions
> **Initial business scope:** Incident + SLA + authorization
> **Assurance scope:** deterministic compilation, deployability, read-only connectivity, and authentication readiness
> **Release-gate status:** compile-only results are never release-gate eligible

## What works in M1-02A

The application proves this complete path:

```text
versioned business blueprint YAML
  -> Zod runtime validation
  -> deterministic semantic compilation
  -> COMPILE_ONLY run orchestration
  -> atomic immutable filesystem run bundle
  -> Fastify control-plane API
  -> React operations console
```

It includes:

- one approved payment/API service-degradation blueprint and eight risk variations;
- versioned environment, blueprint, executable-plan, run, evidence, probe, error, and coverage contracts;
- deterministic plan and step IDs with source links back to business steps;
- committed-only filesystem bundles behind a single core persistence port;
- a bounded read-only NILES probe for confirmed liveness, readiness, build, and validated OpenAPI routes;
- a CLI and machine-readable artifacts;
- Environments, Scenario Library, Run Center, Evidence Explorer, and Coverage UI routes;
- unit, integration, API, and Playwright smoke coverage;
- deterministic GitHub Actions CI with no live NILES dependency;
- one immutable non-root production image serving the SPA and API on port 4100;
- versioned local liveness, readiness, and build-information endpoints;
- manual exact-SHA staging deployment with health verification and rollback;
- sanitized actor profiles and strict environment mappings for five synthetic personas;
- replaceable secret and NILES-authenticator boundaries with independent in-memory sessions;
- an operator-triggered authentication preflight UI with production denial and safe typed outcomes.

## What M1-02A does not prove

A compile-only `PASS` means only that the reviewed blueprint compiled and its artifacts persisted within `COMPILATION_ONLY` scope. Every such run has:

```json
{
  "runType": "COMPILE_ONLY",
  "verdict": "PASS",
  "assuranceScope": "COMPILATION_ONLY",
  "gateEligible": false,
  "stepResults": [
    {
      "compilationStatus": "PASS",
      "executionStatus": "NOT_EXECUTED"
    }
  ]
}
```

M1-02A does not claim that NILES Incident lifecycle, SLA behavior, authorization, tenant isolation, side effects, cleanup, or release readiness passed. Authentication preflight confirms only that separately configured synthetic actors can establish normal NILES sessions. It performs no NILES business mutation.

## Repository layout

```text
apps/
  api/                    Fastify composition root and CLI
  web/                    React + Vite operations console
packages/
  contracts/              Versioned runtime contracts
  domain/                 Compiler, policy, verdicts, canonical serialization
  core/                   Use cases and ports
  adapter-niles/          Confirmed read-only probe and login transport
  secret-provider-environment/ Initial runtime secret boundary
  storage-filesystem/     YAML inputs and JSON run bundles
actors/                    Sanitized profiles and environment mappings
scenarios/itsm/incident/  Reviewed business blueprints
environments/             Non-sensitive target definitions
artifacts/                Ignored local run and browser output
ops/                      Deployment, rollback, verification, and runbook
docs/discovery/           Confirmed/partial/unknown/missing NILES facts
docs/adr/                 Accepted implementation decisions
```

## Prerequisites

- Node.js `24.18.0` LTS
- pnpm `11.13.0`, invoked through Corepack

The selected versions are pinned in repository metadata and CI.

## Setup and commands

Install exactly from the lockfile:

```bash
corepack pnpm install --frozen-lockfile
```

Start the API and web console together:

```bash
corepack pnpm dev
```

- Web console: `http://127.0.0.1:4173`
- API liveness: `http://127.0.0.1:4100/api/health/live`

Common commands:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm run ci
```

`corepack pnpm run ci` is the single required local/CI validation command. Install the Chromium binary once before running browser tests on a fresh machine:

```bash
corepack pnpm exec playwright install chromium
```

Build and run the production topology locally:

```bash
export NVS_BUILD_SHA="$(git rev-parse HEAD)"
export NVS_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose up --build
```

The console and API are then both available at `http://127.0.0.1:4100`. `compose.yml` mounts reviewed configuration read-only and stores run/evidence artifacts in the `nvs-data` volume. Remove the service with `docker compose down`; add `--volumes` only when intentionally deleting local evidence.

## Deterministic example workflow

Create a local compile-only run without starting the servers:

```bash
corepack pnpm example:run
```

The command:

1. loads `environments/local.example.yaml`;
2. validates `payment-api-service-degradation.v1.yaml`;
3. selects the normal journey;
4. compiles a deterministic executable plan;
5. writes run, plan, and evidence JSON under `artifacts/runs/example-compile-only/`;
6. prints a machine-readable summary that includes `gateEligible: false`.

In the console, open Scenario Library, review the business narrative, choose Run Center, select a variation, launch the compile-only run, and inspect the durable plan and evidence in Evidence Explorer.

## Runtime configuration, actors, and secrets

Environment definitions are strict `nvs.environment/v1` YAML files under `environments/`. They contain:

- a non-secret base URL and target classification;
- confirmed health/readiness/OpenAPI/build paths;
- non-sensitive capability declarations;
- an optional symbolic authentication-profile reference.

Credential values are forbidden in URLs and versioned fields. Actor profiles under `actors/profiles/` contain only persona expectations and symbolic `credentialRef` values; mappings under `actors/mappings/` bind the required personas to one environment. Committed contract validation rejects secret-bearing fields recursively.

M1-02A resolves credentials from environment variables named deterministically from the symbolic reference. Values are JSON objects containing exactly `email` and `password`; `.env.example` lists sanitized placeholders. The API and browser return only `MISSING`, `CONFIGURED`, `INVALID`, authenticated, or typed blocked states. Passwords and bearer/session material stay in private memory and are destroyed after each independent preflight. Never reuse real people or production identities.

The API host and port may be changed with `NVS_API_HOST` and `NVS_API_PORT`. Production paths are configured with `NVS_CONFIG_DIR`, `NVS_DATA_DIR`, and `NVS_WEB_DIR`. Build identity uses `NVS_BUILD_SHA`, `NVS_BUILD_TIMESTAMP`, and `NVS_RELEASE_VERSION`.

The staging workflow is manual and uses the GitHub `staging` environment. See [the staging bootstrap and operations runbook](ops/bootstrap-staging.md) for server setup, required SSH secrets, exact-image deployment, verification, backups, credential injection, and rollback. The workflow being present does not mean a real staging deployment has been proven.

## Optional live read-only probe

CI never contacts NILES. A live probe is an explicit operator action and uses GET only.

1. Review or add a non-sensitive environment definition.
2. Keep it disabled until the URL and classification are approved.
3. Enable it and run:

```bash
corepack pnpm probe:niles -- --environment local-example
```

Alternatively, use the Environments page and select **Run read-only probe**. A failed or degraded required health/readiness capability returns `BLOCKED`. Missing optional OpenAPI or build metadata is shown as unavailable.

Do not place credentials in an environment file, and do not use this command to work around environment approval.

## Architecture and NILES findings

- [M1-01 stack ADR](docs/adr/ADR-0001-M1-WALKING-SKELETON-STACK.md)
- [M1-02A deployment and actor-session ADR](docs/adr/ADR-0002-DEPLOYMENT-AND-ACTOR-SESSION-FOUNDATION.md)
- [NILES contract findings at inspected GRC commit](docs/discovery/NILES_CONTRACT_FINDINGS_M1.md)
- [Implementation authorization](docs/IMPLEMENTATION_AUTHORIZATION_2026-07-14.md)
- [NILES testability contract](docs/NILES_TESTABILITY_CONTRACT.md)
- [MVP contract](docs/MVP.md)

## Next slice: M1-02B

M1-02B may add authenticated Incident API execution only after an isolated deterministic fixture namespace, lifecycle assertions, cleanup, and correlated evidence contracts are available or explicitly accepted as blockers. It must not infer missing metadata, policy, fixture, event/job, cleanup, or virtual-time contracts.
