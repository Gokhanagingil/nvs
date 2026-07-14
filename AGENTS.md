# AGENTS.md — NVS Engineering Contract

## Mission and phase

NVS is an external, evidence-producing validation system for NILES. Its immediate purpose is to reduce repeated manual ITSM UAT effort and protect NILES release quality as the platform reaches customers.

M1 implementation is authorized. Read, in order:

1. `docs/IMPLEMENTATION_AUTHORIZATION_2026-07-14.md`
2. the issue or task defining the current PR
3. this file
4. `PROJECT_CHARTER.md`
5. `docs/DECISIONS.md`
6. `docs/ARCHITECTURE.md`
7. `docs/MVP.md`
8. `docs/NILES_TESTABILITY_CONTRACT.md`

The dated implementation authorization supersedes older documentation-only and CLI-only wording.

## Repository boundary

- `Gokhanagingil/nvs` is writable.
- Treat `Gokhanagingil/grc` as read-only unless a separate task explicitly authorizes a NILES change.
- Never mix NVS and NILES changes in one PR.
- Cite confirmed NILES behavior with exact repository paths and the inspected commit when practical.
- Do not copy NILES internals into NVS; integrate through supported contracts and narrowly documented testability seams.

## Non-negotiable product rules

1. NVS validates NILES from outside the product boundary.
2. Custom value belongs in NILES-aware scenario semantics, generation, deterministic oracles, coverage, and evidence—not a custom browser or generic HTTP engine.
3. Approved assertions and observable evidence decide `PASS`, `FAIL`, or `BLOCKED`. AI may propose and explain, but is not the release oracle.
4. Authors work with business narratives, actors, preconditions, expected outcomes, variations, and evidence. Low-level actions belong in a compiled plan.
5. Authorization and tenant isolation are proved API-first; selected UI checks prove user-facing consistency.
6. CLI and machine-readable artifacts are required, and a thin web operations console is required from the first working slice.
7. Negative paths are first-class. Missing evidence, invalid transitions, insufficient access, and cross-tenant attempts are normal coverage.
8. Missing prerequisites or uncertain evidence must become `BLOCKED`, never `PASS`.
9. Do not silently alter an expected result to make a test pass.
10. Do not generalize for other products in a way that delays the NILES-first slice.

## M1 boundary

The first complete story is a realistic Incident + SLA + authorization journey for a customer-facing service degradation.

The first UI contains:

- Environments
- Scenario Library
- Run Center
- Evidence Explorer
- Coverage

Do not build a drag-and-drop designer, commercial administration, billing, marketplace, distributed scheduling, broad analytics warehouse, custom browser engine, or generic no-code automation platform during M1.

## Architecture baseline

Unless a reviewed ADR in the current PR justifies a change, use:

- strict TypeScript;
- a pinned supported Node.js LTS release;
- pinned `pnpm` workspaces;
- React + Vite for the web console;
- Fastify for the control-plane API;
- Zod for versioned runtime contracts;
- Vitest for unit and integration tests;
- Playwright for browser execution and UI smoke;
- filesystem-backed repositories behind interfaces for initial storage;
- structured logs and correlated evidence.

Use these logical boundaries only when the current slice needs them:

```text
apps/api
apps/web
packages/contracts
packages/domain
packages/core
packages/adapter-niles
packages/storage-filesystem
packages/runner-http
packages/runner-playwright
scenarios
environments
artifacts
```

Domain and contract code must not depend on UI frameworks, filesystems, Playwright, or NILES-specific mechanics.

## Scenario layers

Keep three layers explicit:

1. **Business blueprint:** narrative, objective, actors, preconditions, human-readable steps, expected state/SLA/access/side-effect outcomes, variation dimensions, evidence, and cleanup.
2. **Executable domain plan:** deterministic semantic actions, actor context, resolved inputs, assertions, evidence requests, cleanup operations, and source linkage.
3. **Runner operations:** concrete HTTP, Playwright, metadata, and evidence-reader behavior implemented by adapters.

The blueprint must remain readable by an experienced ITSM practitioner. Runner details must not leak into it.

## NILES contract discipline

Never guess endpoints, states, permissions, response shapes, SLA meaning, UI identifiers, or side effects.

For every NILES dependency:

- inspect the actual NILES repository and existing tests;
- classify it as `CONFIRMED`, `PARTIAL`, `UNKNOWN`, or `MISSING`;
- cite the exact source path in a discovery artifact;
- isolate unstable details inside `adapter-niles`;
- add a contract fixture or test where practical;
- use `BLOCKED` when required evidence cannot be obtained reliably.

Document any required NILES-side seam; do not modify NILES without separate authorization.

## Security and evidence

- Do not commit secrets, customer data, production exports, or real personal data.
- Keep versioned environment files non-sensitive and resolve confidential values at runtime.
- Sanitize sensitive headers, cookies, fields, and configured patterns from evidence.
- Prevent mutating runs against environments marked production.
- Use deterministic test namespaces and tenant-safe cleanup.
- Do not depend on random shared staging records.
- Preserve least privilege for test actors.
- For a denied operation, verify the absence of observable unauthorized side effects when NILES exposes the required evidence.

## Engineering standards

- Keep TypeScript strict; isolate and justify any unavoidable unsafe type.
- Prefer pure domain logic and explicit ports/adapters over global mutable state.
- Distinguish product, assertion, adapter, environment/setup, cleanup, and cancellation failures.
- Avoid hidden retries and fixed sleeps. Use observable conditions and explicit deadlines.
- Version persisted and external formats from the first implementation.
- Avoid unrelated refactors and unnecessary dependencies.
- Show real API-backed states in the UI with clear loading, empty, error, and BLOCKED states.
- Display business steps first; expose technical details by drilldown.
- Keep the UI keyboard-accessible and add stable test identifiers only when semantic locators are insufficient.

## Testing

Every implementation PR must cover the layers it changes, including relevant schema validation, deterministic compilation, verdict/error classification, repositories, API integration, adapter fixtures, and at least one UI smoke path.

Required local and CI tests must never silently skip because setup failed. Live-environment suites may be optional only when clearly separated and reported.

Provide one documented command that runs all required CI checks.

## Git and agent workflow

- Work on an `agent/<description>` branch unless the task says otherwise.
- Keep commits focused and open a draft PR linked to the governing issue.
- Do not merge the PR.
- Stop at the declared issue boundary and record follow-ups instead of expanding scope.
- Before editing, read the governing docs, inspect both repository contexts as needed, state a concise plan, and identify material contradictions.
- Proceed without waiting on ordinary reversible choices. Ask only when safe completion requires a material Product Owner decision.
- When blocked, do not invent behavior. Preserve the interface seam, document the exact blocker, and report it explicitly.

A task is complete only when acceptance criteria, builds, tests, UI behavior in scope, documentation, contract findings, and a reviewable draft PR are all present.
