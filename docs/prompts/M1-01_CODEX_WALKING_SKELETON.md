# Codex Prompt — M1-01 NVS Walking Skeleton

Use this prompt after the implementation-kickoff PR is merged.

**Recommended execution surface:** Codex in the ChatGPT desktop app or Codex IDE extension, with both repositories in one project.  
**Recommended model:** GPT-5.6 Sol, Extra High reasoning.  
**Do not use Ultra for this first PR:** architectural coherence is more important than parallel subagent speed.  
**Writable repository:** `Gokhanagingil/nvs`  
**Read-only reference repository:** `Gokhanagingil/grc`  
**Governing issue:** `Gokhanagingil/nvs#2`

---

## Prompt to give Codex

You are implementing **M1-01 — the first working walking skeleton of NVS (NILES Validation Suite)**.

Work autonomously through inspection, implementation, validation, commits, push, and a draft pull request. Do not wait for approval on ordinary reversible engineering choices. Stop and ask only when a safe implementation requires a material Product Owner decision.

### 1. Operating context

Open both repositories in the same Codex project:

- `Gokhanagingil/nvs` — writable; all implementation changes belong here.
- `Gokhanagingil/grc` — read-only; use it to confirm actual NILES contracts and existing test conventions.

Create a new branch from the latest NVS `main`:

```text
agent/m1-01-walking-skeleton
```

Do not modify or commit anything to the NILES repository.

Read these NVS files before editing:

1. `AGENTS.md`
2. `docs/IMPLEMENTATION_AUTHORIZATION_2026-07-14.md`
3. `PROJECT_CHARTER.md`
4. `docs/DECISIONS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/MVP.md`
7. `docs/NILES_TESTABILITY_CONTRACT.md`
8. GitHub issue #2

Treat `AGENTS.md` and the dated implementation authorization as the latest binding instructions when older discovery text conflicts.

### 2. Objective

Deliver a runnable, tested NVS application with a thin web console and control-plane API that proves the complete internal architecture path:

```text
versioned business scenario file
  -> runtime schema validation
  -> deterministic semantic compilation
  -> compile-only run orchestration
  -> filesystem run/evidence persistence
  -> API
  -> web UI
```

Also implement a **read-only NILES environment probe** using contracts confirmed from the NILES repository.

This PR must create a real working vertical skeleton, not disconnected mock screens and not only documentation. It must not yet mutate Incident records in NILES; that is M1-02.

### 3. Required pre-implementation discovery

Inspect the current default branch of `Gokhanagingil/grc` and write:

```text
docs/discovery/NILES_CONTRACT_FINDINGS_M1.md
```

Record the inspected commit SHA and classify each item as `CONFIRMED`, `PARTIAL`, `UNKNOWN`, or `MISSING`.

Investigate at least:

- supported runtime and package-manager conventions;
- frontend and backend startup boundaries;
- liveness/readiness/health endpoints;
- authentication login endpoint and response shape;
- tenant-context transport such as headers or claims;
- OpenAPI/Swagger exposure;
- Incident list/detail/create/update and lifecycle action endpoints;
- confirmed Incident state values and transition policy;
- assignment, ownership, hold, resume, resolve, close, and reopen behavior;
- SLA summary/instance endpoints and observable lifecycle data;
- audit/event evidence externally readable by a validation client;
- UI routes for Incident list/detail;
- stable UI selectors or test-ID conventions;
- existing Incident API/E2E tests and Playwright configuration;
- safe local or staging test-data conventions;
- any facts needed later that remain unavailable.

For each confirmed fact, cite exact repository paths. Do not infer a contract only from a design document when implementation or a test gives stronger evidence. Clearly separate current runtime behavior from target or advisory designs.

If the NILES repository contains conflicting implementations, record the conflict rather than choosing silently.

### 4. Architecture baseline

Create a strict TypeScript `pnpm` workspace. Pin the selected Node LTS and package-manager versions.

Use:

- React + Vite for `apps/web`;
- Fastify for `apps/api`;
- Zod for runtime schemas and inferred TypeScript types;
- Vitest for unit/integration tests;
- Playwright for one critical UI smoke path;
- native `fetch` or a narrowly justified standard HTTP client;
- filesystem repositories behind interfaces for initial persistence.

Create only boundaries that this PR actually uses. Expected minimum:

```text
apps/
  api/
  web/
packages/
  contracts/
  domain/
  core/
  adapter-niles/
  storage-filesystem/
scenarios/
  itsm/incident/
environments/
artifacts/                 # ignored local output
```

A separate HTTP-runner or Playwright-runner package may be deferred until M1-02/M1-04 if it would be empty in this PR.

Create an ADR documenting the actual M1-01 stack and boundaries:

```text
docs/adr/ADR-0001-M1-WALKING-SKELETON-STACK.md
```

### 5. Versioned contracts

Implement runtime-validated, versioned contracts for at least the following concepts.

#### 5.1 Environment definition v1

Include:

- stable ID;
- display name;
- base URL;
- environment kind such as local, test, staging, or production;
- health path and optional OpenAPI path;
- non-sensitive capability declarations;
- symbolic authentication-profile reference, not a confidential value;
- enabled/disabled state;
- timestamps or source metadata only when useful.

Validation must reject malformed URLs, unsupported schema versions, unsafe IDs, and confidential values accidentally placed in versioned fields where detectable.

A mutating run must be impossible against an environment marked production. M1-01 is read-only/compile-only, but establish the invariant in the domain contract now.

#### 5.2 Business scenario blueprint v1

Include:

- stable ID and schema version;
- title, narrative, objective, and risk tags;
- business domain and process;
- actors/personas;
- preconditions and deterministic fixture requirements;
- human-readable business steps;
- expected state, SLA, authorization, relationship, audit, event, notification, and evidence outcomes as applicable;
- variation dimensions;
- evidence requirements;
- cleanup/isolation policy;
- review state: generated, reviewed, or approved;
- provenance and version metadata.

The author-facing file must be understandable to an experienced ITSM practitioner without reading source code.

#### 5.3 Executable domain plan v1

The deterministic compiler must convert one validated blueprint plus a selected variation into:

- stable plan and step IDs;
- explicit actor context;
- semantic action primitives;
- resolved inputs or unresolved reference placeholders;
- deterministic assertions;
- evidence requests;
- cleanup intent;
- source links back to blueprint steps and variation values.

Runner mechanics, CSS selectors, and concrete endpoint paths must not appear in the business blueprint.

#### 5.4 Run and evidence contracts v1

Include:

- run ID, run type, lifecycle status, and verdict;
- `PASS`, `FAIL`, or `BLOCKED` semantics;
- explicit `gateEligible` or assurance-scope field so a compile-only PASS cannot be mistaken for a NILES release PASS;
- environment ID;
- scenario ID/version;
- variation values;
- target version/commit when known;
- tool and contract versions;
- timestamps;
- step results and typed error category;
- evidence manifest entries;
- artifact-relative paths only;
- sanitization/redaction metadata;
- cleanup status.

Distinguish at least:

- product failure;
- assertion failure;
- adapter failure;
- environment/setup failure;
- scenario/contract failure;
- persistence failure;
- cleanup failure;
- cancellation.

### 6. First realistic business scenario

Add this approved scenario as a versioned YAML file:

```text
scenarios/itsm/incident/payment-api-service-degradation.v1.yaml
```

Narrative:

> A customer-facing payment/API service suffers severe degradation during an active support window. A requester reports the impact. Service Desk triages the incident, establishes operational ownership, relates the affected service/CI context where supported, observes the applicable response and resolution SLA, places the incident on hold while waiting for an external provider, resumes work, restores service, records resolution evidence, resolves the incident, and closes it under the correct authority.

Represent business actors such as:

- requester;
- service desk agent;
- incident manager or authorized closer;
- insufficiently privileged user;
- cross-tenant actor.

Include configurable or symbolic references for tenant, service, offering, CI, assignment group, impact, urgency, hold reason, SLA policy, and closure authority.

Include variation dimensions for at least:

- normal successful journey;
- missing resolution evidence;
- close before resolve;
- insufficient role for agent-only action;
- unauthenticated attempt;
- cross-tenant attempt;
- hold/resume SLA behavior;
- priority and SLA-policy matching.

M1-01 compiles these variations but does not execute NILES mutations.

The compiled semantic plan may use internal actions such as:

```text
incident.report
incident.triage
incident.assign
incident.take_ownership
incident.link_service_context
incident.hold
incident.resume
incident.resolve
incident.close
incident.read
sla.read_summary
evidence.read_audit
```

Do not make these primitive names the main author-facing step text.

### 7. Core use cases

Implement deterministic use cases for:

- load and validate environment definitions;
- probe a NILES environment read-only;
- load, validate, list, and retrieve business scenarios;
- compile a scenario and selected variation;
- create and execute a `COMPILE_ONLY` run;
- persist run and evidence manifests atomically;
- list and retrieve runs;
- derive an initial semantic coverage view from scenario declarations and compiled plans.

A compile-only run may return `PASS` only for its declared compilation scope and must set `gateEligible: false`. It must never be presented as proof that NILES behavior passed.

Ensure compilation is deterministic: the same blueprint version and variation input must produce equivalent plan content aside from explicitly excluded run metadata.

### 8. Read-only NILES adapter

Create a narrow target-adapter interface and a NILES implementation.

For M1-01, implement only confirmed read-only capabilities such as:

- health/readiness probe;
- optional OpenAPI availability probe;
- optional safe version/build fingerprint when a confirmed endpoint exposes it.

Do not hard-code assumptions that the discovery document marks unknown. Make paths configurable through the environment definition when appropriate, with confirmed NILES defaults documented in the adapter.

Return typed capability results. A missing optional endpoint should be represented as an unavailable capability, not a crash. A required health failure should result in a clear environment BLOCKED/error classification.

Provide a deterministic mock adapter for required CI tests; CI must not call the public internet or a live NILES environment.

### 9. Filesystem persistence

Implement repository interfaces and filesystem-backed adapters for:

- environments;
- scenario blueprints;
- runs;
- evidence manifests.

Requirements:

- safe path handling;
- atomic writes where feasible;
- stable serialization;
- no confidential values in stored artifacts;
- clear corruption/validation errors;
- local artifacts under ignored directories;
- sanitized example files committed to the repository.

Add at least:

```text
environments/local.example.yaml
environments/staging.example.yaml
```

These files must not contain working confidential values.

### 10. Control-plane API

Implement a versioned API under `/api` with at least:

```text
GET  /api/health
GET  /api/environments
POST /api/environments/:id/probe
GET  /api/scenarios
GET  /api/scenarios/:id
POST /api/scenarios/:id/compile
POST /api/runs                 # COMPILE_ONLY in M1-01
GET  /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/evidence
GET  /api/coverage
```

Use runtime validation at API boundaries and one consistent typed error envelope. Reject unknown fields where doing so improves safety. Do not leak local absolute paths or stack traces to the web client.

Use a composition root in `apps/api`; domain packages must not import Fastify.

### 11. Web operations console

Build a functional API-backed console with these routes or equivalent navigation:

1. **Environments**
   - list definitions;
   - show kind and enabled state;
   - run the read-only probe;
   - show health, OpenAPI, version, capability, error, and BLOCKED states.

2. **Scenario Library**
   - list scenarios;
   - show narrative, objective, actors, business steps, variations, risks, evidence requirements, schema version, and review state;
   - do not reduce the display to primitive action IDs.

3. **Run Center**
   - choose scenario and variation values;
   - launch a compile-only run;
   - display progress by business step;
   - make the non-release `gateEligible: false` status obvious.

4. **Evidence Explorer**
   - list runs;
   - show PASS/FAIL/BLOCKED and assurance scope;
   - show failed expectation or typed error;
   - show plan/evidence entries and correlation identifiers;
   - never show confidential values.

5. **Coverage**
   - present the initial scenario x actor x transition/action x SLA x negative-access coverage derived from versioned declarations;
   - clearly label declared, compiled, and not-yet-executed coverage.

Provide accessible labels, keyboard navigation, loading/empty/error states, and stable selectors only where semantic locators are insufficient.

The UI should be visually coherent and usable, but do not spend this PR on a bespoke design system.

### 12. Developer experience and commands

Provide:

- root install, dev, build, test, lint/typecheck, and CI commands;
- one command that starts API and web for local development;
- one command that runs all required CI checks;
- sample configuration documentation;
- a clear optional command for a live read-only NILES probe;
- no dependency on globally installed project tools other than the pinned runtime/package manager.

Update `README.md` with:

- what M1-01 does and does not prove;
- repository layout;
- setup and commands;
- example workflow from scenario library to compile-only evidence;
- how runtime configuration is supplied;
- how live probes are separated from deterministic CI;
- next planned slice M1-02.

### 13. Testing and CI

Add tests for at least:

- valid and invalid environment definitions;
- valid and invalid business blueprints;
- deterministic plan compilation;
- each declared scenario variation compiling or failing for the intended reason;
- verdict and error classification;
- safe filesystem repository behavior and corruption handling;
- NILES probe behavior using deterministic fixtures/mock server;
- API integration for the critical endpoints;
- one Playwright UI smoke journey:
  - open Scenario Library;
  - inspect the payment-service narrative;
  - launch a compile-only run;
  - view its evidence;
  - verify it is clearly not release-gate eligible.

Add GitHub Actions for install, typecheck, lint if configured, tests, build, and the deterministic UI smoke. Cache only what is safe and keyed correctly.

No required CI test may contact a live NILES environment or silently skip due to setup failure.

### 14. Security and operational checks

Verify before opening the PR:

- generated examples contain no confidential values;
- local evidence and environment overrides are ignored;
- API responses do not expose absolute filesystem paths or internal stack traces;
- URL and path inputs are validated;
- mutating-run capability is rejected for production environments by domain policy, even though M1-01 has no mutating runner;
- evidence serialization applies the initial sanitization policy;
- the UI does not render raw untrusted HTML.

### 15. Explicit non-goals for this PR

Do not implement:

- authenticated Incident creation or lifecycle mutation in NILES;
- SLA mutation or accelerated time;
- role impersonation against a live environment;
- Playwright automation of NILES itself;
- AI-provider/API integration;
- a database;
- distributed workers or queues;
- drag-and-drop scenario authoring;
- commercial product features;
- changes to the NILES repository;
- a generic abstraction whose only purpose is hypothetical non-NILES support.

Create follow-up issues or a clearly separated backlog section for discovered work instead of expanding this PR.

### 16. Required validation before PR

Run all applicable commands and record the exact results:

- clean install from lockfile;
- formatting/lint checks when configured;
- TypeScript typecheck;
- unit and integration tests;
- production builds for API and web;
- Playwright UI smoke;
- a local deterministic example run;
- optional live read-only NILES probe only when configuration is available, clearly separated from CI evidence.

Inspect the final diff for unrelated or generated noise.

### 17. Commit and pull-request requirements

Use focused commits. A reasonable sequence is:

1. repository and toolchain scaffold;
2. contracts/domain/compiler;
3. filesystem persistence and API;
4. NILES discovery and read-only adapter;
5. web console;
6. tests/CI/docs.

The exact sequence may change, but do not collapse unrelated work into one opaque commit.

Push the branch and open a **draft PR** targeting `main` with a title similar to:

```text
feat: add NVS M1 walking skeleton
```

Link issue #2.

The PR body must include:

- business outcome;
- scope and non-goals;
- architecture and ADR summary;
- confirmed NILES contracts with inspected SHA;
- unknown or missing NILES capabilities;
- UI screenshots;
- test/build results;
- security/data-handling notes;
- exact meaning of compile-only PASS and `gateEligible: false`;
- follow-ups required for M1-02.

Do not merge the PR.

### 18. Final response

After the draft PR is open, report:

- branch and PR;
- concise architecture summary;
- what is working end to end;
- tests and builds executed;
- confirmed NILES facts;
- blockers or missing contracts;
- follow-up work for M1-02;
- any material decision the Product Owner must make.

Do not claim that NILES Incident, SLA, authorization, or release readiness has passed. M1-01 proves the NVS walking skeleton and read-only connectivity only.
