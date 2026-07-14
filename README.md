# NVS — NILES Validation Suite

NVS is an external, evidence-producing validation system for NILES. M1-01 delivers the first runnable walking skeleton for internal NILES release assurance.

> **Current slice:** M1-01 walking skeleton
> **Initial business scope:** Incident + SLA + authorization
> **Assurance scope:** deterministic compilation and read-only NILES connectivity
> **Release-gate status:** compile-only results are never release-gate eligible

## What works in M1-01

The application proves this complete path:

```text
versioned business blueprint YAML
  -> Zod runtime validation
  -> deterministic semantic compilation
  -> COMPILE_ONLY run orchestration
  -> atomic filesystem run/evidence artifacts
  -> Fastify control-plane API
  -> React operations console
```

It includes:

- one approved payment/API service-degradation blueprint and eight risk variations;
- versioned environment, blueprint, executable-plan, run, evidence, probe, error, and coverage contracts;
- deterministic plan and step IDs with source links back to business steps;
- filesystem repositories behind core ports;
- a read-only NILES probe for confirmed liveness, readiness, build, and OpenAPI routes;
- a CLI and machine-readable artifacts;
- Environments, Scenario Library, Run Center, Evidence Explorer, and Coverage UI routes;
- unit, integration, API, and Playwright smoke coverage;
- deterministic GitHub Actions CI with no live NILES dependency.

## What M1-01 does not prove

A compile-only `PASS` means only that the reviewed blueprint compiled and its artifacts persisted within `COMPILATION_ONLY` scope. Every such run has:

```json
{
  "runType": "COMPILE_ONLY",
  "verdict": "PASS",
  "assuranceScope": "COMPILATION_ONLY",
  "gateEligible": false
}
```

M1-01 does not claim that NILES Incident lifecycle, SLA behavior, authorization, tenant isolation, side effects, or release readiness passed. It does not authenticate to NILES or mutate NILES data. Those capabilities begin in M1-02 after the missing testability contracts are resolved.

## Repository layout

```text
apps/
  api/                    Fastify composition root and CLI
  web/                    React + Vite operations console
packages/
  contracts/              Versioned runtime contracts
  domain/                 Compiler, policy, verdicts, canonical serialization
  core/                   Use cases and ports
  adapter-niles/          Confirmed read-only NILES transport
  storage-filesystem/     YAML inputs and JSON run bundles
scenarios/itsm/incident/  Reviewed business blueprints
environments/             Non-sensitive target definitions
artifacts/                Ignored local run and browser output
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
- API health: `http://127.0.0.1:4100/api/health`

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

## Runtime configuration and secrets

Environment definitions are strict `nvs.environment/v1` YAML files under `environments/`. They contain:

- a non-secret base URL and target classification;
- confirmed health/readiness/OpenAPI/build paths;
- non-sensitive capability declarations;
- an optional symbolic authentication-profile reference.

Credential values are forbidden in URLs and versioned fields. M1-01 does not resolve auth profiles. Local overrides, evidence, logs, build output, and browser artifacts are ignored by Git.

The API host and port may be changed with `NVS_API_HOST` and `NVS_API_PORT`. The web development proxy expects the default API port.

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
- [NILES contract findings at inspected GRC commit](docs/discovery/NILES_CONTRACT_FINDINGS_M1.md)
- [Implementation authorization](docs/IMPLEMENTATION_AUTHORIZATION_2026-07-14.md)
- [NILES testability contract](docs/NILES_TESTABILITY_CONTRACT.md)
- [MVP contract](docs/MVP.md)

## Next slice: M1-02

M1-02 is expected to add authenticated Incident API execution, an isolated deterministic fixture namespace, lifecycle assertions, and correlated evidence. It must not infer the currently missing metadata, policy, fixture, event/job, cleanup, or virtual-time contracts.
