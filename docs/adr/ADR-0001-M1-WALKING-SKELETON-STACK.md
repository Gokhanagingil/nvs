# ADR-0001 — M1 Walking Skeleton Stack and Boundaries

> **Status:** Accepted for M1-01
> **Date:** 2026-07-14
> **Scope:** NVS walking skeleton only

## Context

M1-01 must prove a complete internal path from a reviewed business blueprint to deterministic compilation, compile-only orchestration, durable evidence, API access, and a usable web console. It must also prove read-only NILES connectivity without mutating Incident or SLA data.

The binding project baseline requires strict TypeScript, a pinned Node LTS and pnpm workspace, React/Vite, Fastify, Zod, Vitest, Playwright, and filesystem-backed repositories behind ports. The implementation must focus custom code on NILES-aware semantics and evidence instead of rebuilding browser or HTTP engines.

## Decision

### Runtime and workspace

- Recommend and pin Node.js `24.18.0` LTS through `.nvmrc`, `.node-version`, package engines, and CI.
- Pin pnpm `11.13.0` through `packageManager`, package engines, and CI.
- Use one pnpm monorepo so contracts and adapters evolve together during M1.
- Keep dependency versions exact in package manifests and the lockfile.

### Application stack

- `apps/api`: Fastify composition root and CLI.
- `apps/web`: React with Vite and React Router.
- Zod is the runtime contract authority; TypeScript types are inferred in domain packages where practical.
- Vitest covers contract, domain, storage, adapter, and API behavior.
- Playwright validates one deterministic NVS-console journey. It does not automate NILES in M1-01.
- Native `fetch` implements the narrow read-only NILES probe.

### Logical boundaries

- `packages/contracts` owns versioned environment, blueprint, plan, run, evidence, probe, error, and coverage shapes.
- `packages/domain` owns deterministic compilation, canonical serialization, verdict classification, and environment safety policy.
- `packages/core` owns use cases and repository/adapter ports.
- `packages/adapter-niles` owns confirmed NILES transport details and uses GET only.
- `packages/storage-filesystem` owns YAML input loading and immutable run-bundle persistence.
- `apps/api` is the only Fastify-aware composition root.
- `apps/web` consumes the control-plane API and does not import filesystem or domain implementations.

No separate HTTP-runner or Playwright-runner package is created because M1-01 executes no NILES business action. Those boundaries would be empty.

### Persistence

- Reviewed environments and scenarios are versioned YAML.
- Local run bundles are stable JSON under ignored `artifacts/runs/<run-id>/`.
- Repository interfaces isolate filesystem mechanics from use cases.
- A single bundle operation validates, sanitizes, and canonicalizes run, plan, and evidence documents before writing them to a hidden staging directory.
- Exact persisted bytes are hashed before an atomic commit marker makes the complete bundle visible; readers ignore uncommitted or incomplete directories.
- Run IDs are immutable. An existing directory is never overwritten and produces `RUN_ID_ALREADY_EXISTS`.
- Persisted and client-visible paths are artifact-relative.

### Assurance semantics

- M1-01 creates only `COMPILE_ONLY` runs.
- A successful compile-only run may be `PASS` only for `COMPILATION_ONLY`.
- Every compile-only run has `gateEligible: false`.
- Step results report compilation independently from NILES execution; compile-only execution is always `NOT_EXECUTED`.
- The console must state that compile-only PASS is not a NILES Incident, SLA, authorization, tenant-isolation, or release verdict.
- Missing prerequisites or uncertain required evidence become `BLOCKED`.

### NILES probe

- Confirmed defaults are `GET /health/live`, `GET /health/ready`, `GET /health/version`, and optional `GET /api/docs-json`.
- Paths remain configurable in versioned environment definitions.
- The adapter accepts direct or globally wrapped readiness/version responses.
- Every probe request has a bounded deterministic deadline.
- OpenAPI is available only when a successful JSON response contains a top-level `openapi` or `swagger` field.
- A degraded or unclassifiable readiness response blocks the probe.
- Missing optional OpenAPI or build metadata remains an unavailable capability.
- No authentication, Incident action, SLA mutation, fixture control, or test clock is part of M1-01.

### Security

- Environment files contain symbolic auth-profile references, never credentials.
- Contracts reject credential-bearing URLs, unsafe identifiers, traversal, unknown fields, and obvious secret-bearing keys.
- The domain policy rejects any future mutating run against an environment classified as production.
- Evidence carries sanitization metadata and is rendered as React text, never raw HTML.
- Local overrides, build outputs, browser artifacts, and run evidence are ignored.

## Consequences

### Positive

- The complete architecture path is executable and testable without a live NILES dependency.
- Business intent stays independent of endpoint paths, selectors, Fastify, React, and filesystem mechanics.
- NILES contract drift is isolated to one adapter.
- CI is deterministic and never calls the public internet or a live NILES environment after dependency/browser installation.
- Storage can be replaced without changing domain contracts or the web API.

### Costs and limitations

- Filesystem storage is single-node and has no distributed transaction or scheduler semantics.
- Versioned schemas are alpha contracts and will require compatibility policy as M1 advances.
- The author-facing YAML still carries semantic action mapping needed by the deterministic compiler; the console keeps that mapping secondary to business narrative.
- The local machine used for initial validation had Node 22.16.0 available. CI and repository metadata remain pinned to Node 24.18.0; release validation should use the pinned runtime.
- M1-01 proves NVS plumbing and read-only connectivity only. It does not prove NILES business behavior.

## Alternatives rejected for M1-01

- A database or distributed worker system: unnecessary for the walking skeleton.
- A custom browser or generic HTTP execution engine: outside NVS differentiation.
- Low-level endpoint or selector scripts as the authoring format: violates the business-blueprint boundary.
- Live staging as a required CI dependency: nondeterministic and unsafe.
- Inferring missing NILES states, policies, evidence, or build values: uncertainty must remain explicit.

## Follow-up

M1-02 may add an authenticated Incident HTTP runner and deterministic fixture namespace only after the missing NILES testability contracts in `docs/discovery/NILES_CONTRACT_FINDINGS_M1.md` are resolved or explicitly accepted as blockers.
