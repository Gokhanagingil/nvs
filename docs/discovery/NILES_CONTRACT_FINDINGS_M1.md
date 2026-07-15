# NILES Contract Findings — M1

> **Inspection date:** 2026-07-14
> **Repository:** `Gokhanagingil/grc`
> **Inspected commit:** `33af470e10fa753b79e092d9a99ef4f570854b10`
> **Inspection mode:** Source and test review only; no live environment was called and no GRC file was changed

## Classification

- `CONFIRMED` — implemented behavior or an executable test establishes the contract.
- `PARTIAL` — useful behavior exists, but it is incomplete, conflicting, or not exposed as a stable external contract.
- `UNKNOWN` — the inspected repository does not establish the intended behavior.
- `MISSING` — the required capability was searched for and no implementation was found.

Implementation and executable tests take precedence over advisory documents. Conflicts are recorded rather than resolved by assumption.

## Runtime and startup boundaries

| Status      | Finding                                                                                                                                   | Evidence                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CONFIRMED` | The repository uses npm lockfiles and root npm scripts to orchestrate its packages.                                                       | `package.json`, `package-lock.json`, `frontend/package-lock.json`, `backend-nest/package-lock.json` |
| `PARTIAL`   | Node is required, but the root repository does not pin one runtime release. Package type declarations currently span Node 22 and Node 25. | `package.json`, `frontend/package.json`, `backend-nest/package.json`, `docs/LOCAL-DEVELOPMENT.md`   |
| `CONFIRMED` | The primary backend is NestJS on port 3002. A legacy Express backend remains on port 3001.                                                | `backend-nest/src/main.ts`, `start-backend.ps1`, `package.json`                                     |
| `CONFIRMED` | The frontend is React/CRA on port 3000 and points directly at port 3002 for local API use.                                                | `frontend/package.json`, `frontend/src/config.ts`, `start-frontend.ps1`                             |

NVS therefore treats the NestJS service on port 3002 as the current NILES backend boundary. It does not target the legacy Express service.

## Read-only environment probe contracts

| Status      | Contract              | Confirmed behavior and source                                                                                                                                                                                                                                                                   |
| ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED` | `GET /health/live`    | Returns liveness fields including `status`, `timestamp`, `uptime`, and service name. `backend-nest/src/health/health.controller.ts`                                                                                                                                                             |
| `CONFIRMED` | `GET /health/ready`   | Returns HTTP 200 with body status `ok` or `degraded` and a database check. Clients must inspect the body, not only the status code. `backend-nest/src/health/health.controller.ts`                                                                                                              |
| `CONFIRMED` | `GET /health/version` | Returns configured commit SHA, short SHA, and build timestamp; any value can be `unknown` when deployment metadata was not supplied. `backend-nest/src/health/health.controller.ts`                                                                                                             |
| `CONFIRMED` | `GET /api/v2/health`  | Canonical aggregate health route. `backend-nest/src/health/health-v2.controller.ts`                                                                                                                                                                                                             |
| `CONFIRMED` | `GET /api/docs-json`  | Swagger/OpenAPI JSON generated at startup. Swagger UI is at `/api/docs`. `backend-nest/src/main.ts`                                                                                                                                                                                             |
| `PARTIAL`   | Response envelope     | The global response interceptor can wrap success bodies in `{ success, data }`; health-focused tests and scripts use a mixture of wrapped and direct assumptions. `backend-nest/src/common/interceptors/response-transform.interceptor.ts`, `backend-nest/src/health/health.controller.spec.ts` |
| `MISSING`   | `GET /grc/health`     | Some product-truth tooling refers to this route, but no matching controller exists in `backend-nest/src`.                                                                                                                                                                                       |

The M1-01 adapter uses only GET requests and configurable paths. The committed local example uses `/health/live`, `/health/ready`, `/health/version`, and `/api/docs-json`. It accepts wrapped or direct readiness/version bodies and treats degraded or unclassifiable readiness as `BLOCKED`.

## Authentication and tenant context

| Status      | Finding                                                                                                                                                 | Evidence                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED` | Login is `POST /auth/login` with `{ email, password }`; password has a six-character minimum.                                                           | `backend-nest/src/auth/auth.controller.ts`, `backend-nest/src/auth/dto/login.dto.ts`                            |
| `CONFIRMED` | Successful login can return `accessToken`, `user`, effective `permissions`, password-policy fields, or an MFA branch with `mfaRequired` and `mfaToken`. | `backend-nest/src/auth/auth.service.ts`                                                                         |
| `CONFIRMED` | Authenticated requests use `Authorization: Bearer …`. Tenant-scoped routes also require UUID header `x-tenant-id`.                                      | `backend-nest/src/auth/strategies/jwt.strategy.ts`, `backend-nest/src/tenants/guards/tenant.guard.ts`           |
| `CONFIRMED` | Normal users must belong to the requested tenant; global admins may select an active tenant. The guard attaches immutable tenant context.               | `backend-nest/src/tenants/guards/tenant.guard.ts`, `backend-nest/src/common/context/tenant-context.resolver.ts` |
| `CONFIRMED` | `x-correlation-id` is accepted and otherwise generated in tenant context.                                                                               | `backend-nest/src/tenants/guards/tenant.guard.ts`                                                               |
| `UNKNOWN`   | A least-privilege, read-only NVS service identity and its issuance/rotation procedure are not defined.                                                  | No dedicated NVS identity contract found.                                                                       |

M1-01 performed no NILES login. M1-02A uses these confirmed contracts only for an explicit authentication-readiness preflight: it submits each dedicated synthetic actor independently, accepts direct or globally wrapped login responses, validates the optional tenant UUID, destroys every in-memory session, and returns only sanitized status. Production preflight is denied before secret resolution or network access. No authenticated NILES business route is called.

## Incident API and lifecycle

All Incident routes below are under `@Controller('grc/itsm/incidents')` and use JWT, tenant, and permission guards.

| Status      | Surface                                                                                                                                                                           | Evidence                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONFIRMED` | List, detail, create, update, soft delete, bulk update                                                                                                                            | `backend-nest/src/itsm/incident/incident.controller.ts`, `backend-nest/test/itsm-incidents.e2e-spec.ts`                                                            |
| `CONFIRMED` | `POST /:id/assign`, `/:id/take-ownership`, `/:id/start-work`, `/:id/hold`, `/:id/resume`, `/:id/resolve`, `/:id/close`, `/:id/reopen`                                             | `backend-nest/src/itsm/incident/incident.controller.ts`                                                                                                            |
| `CONFIRMED` | States are `open`, `in_progress`, `on_hold`, `resolved`, and `closed`.                                                                                                            | `backend-nest/src/itsm/enums/index.ts`                                                                                                                             |
| `CONFIRMED` | Start work requires an open incident and ownership context. Hold accepts active states. Resume accepts on-hold and returns to open or in-progress. Resolve accepts active states. | `backend-nest/src/itsm/incident/incident.service.ts`, `backend-nest/src/itsm/policy/incident-transition-policy.ts`                                                 |
| `PARTIAL`   | Close authority is not represented consistently: policy names requester/admin plus a capability string, while service behavior applies requester/opening-user authority.          | `backend-nest/src/itsm/policy/incident-transition-policy.ts`, `backend-nest/src/itsm/incident/incident.service.ts`                                                 |
| `PARTIAL`   | Reopen exists, but policy target is `open` while service implementation writes `in_progress`; no dedicated reopen E2E case was found.                                             | `backend-nest/src/itsm/policy/incident-transition-policy.ts`, `backend-nest/src/itsm/incident/incident.service.ts`, `backend-nest/test/itsm-incidents.e2e-spec.ts` |
| `PARTIAL`   | Service/offering/CI context is supported through Incident fields and affected-CI routes, but one externally versioned relationship contract is not exposed.                       | `backend-nest/src/itsm/incident/incident.controller.ts`, `backend-nest/src/itsm/incident/incident.service.ts`                                                      |

M1-01 records these facts but does not compile concrete endpoint paths into business blueprints and does not call any mutating route.

### M1-02B reinspection addendum

The same GRC commit `33af470e10fa753b79e092d9a99ef4f570854b10` was reinspected on 2026-07-15 for the frozen live Incident API happy path. Confirmed request contracts:

- `POST /grc/itsm/incidents` accepts `shortDescription`, `description`, `category`, `source`, `impact`, `urgency`, `requesterId`, `assignmentGroupId`, `serviceId`, `offeringId`, and `metadata`. Evidence: `backend-nest/src/itsm/incident/dto/create-incident.dto.ts`.
- Assignment accepts `assignmentGroupId` and optional `assignedTo`. Evidence: `backend-nest/src/itsm/incident/dto/assign-incident-action.dto.ts`.
- Hold requires `pendingReason` and `pendingReasonDetail` with the policy minimum detail length. Evidence: `backend-nest/src/itsm/incident/dto/hold-incident-action.dto.ts`.
- Resume accepts optional target status. Resolve accepts `resolutionNotes`. Close accepts optional `closureNote`. Evidence: `backend-nest/src/itsm/incident/incident.controller.ts`, `backend-nest/src/itsm/incident/dto/resume-incident-action.dto.ts`, `backend-nest/src/itsm/incident/dto/close-incident-action.dto.ts`.
- Affected-CI linkage accepts `ciId`, `relationshipType`, and optional `impactScope`. Evidence: `backend-nest/src/itsm/incident/dto/create-incident-ci.dto.ts`.
- SLA read summary is `GET /grc/itsm/sla/records/:recordType/:recordId`; `INCIDENT` is a canonical record type. Evidence: `backend-nest/src/itsm/sla/sla.controller.ts`, `backend-nest/src/itsm/sla/sla-definition.entity.ts`.
- Incident journal count is `GET /grc/itsm/:table/:recordId/journal/count` with table `incidents`. Evidence: `backend-nest/src/itsm/journal/journal.controller.ts`.

Close remains `PARTIAL` for M1-02B: service behavior requires requester/opening-user authority, while the route also requires `ITSM_INCIDENT_WRITE`. The standard requester role has read-oriented ITSM permissions but not Incident write in the inspected permission service. NVS therefore records the live happy path as `BLOCKED` with stable code `NILES_CLOSE_AUTHORITY_UNSATISFIABLE` unless an approved requester-safe close/intake authority is provided. It must not close with an admin/manager substitute and call that `PASS`.

## SLA observability

| Status      | Finding                                                                                                                                                                    | Evidence                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED` | Read surfaces include definition list/detail, instance list, record instances, single/batch summaries, status, record history, and instance history under `/grc/itsm/sla`. | `backend-nest/src/itsm/sla/sla.controller.ts`                                                                                                            |
| `CONFIRMED` | Public summaries include start/due/pause/stop timestamps, elapsed and remaining seconds, paused duration, warning/breach fields, target values, and policy attribution.    | `backend-nest/src/itsm/sla/dto/sla-record-summary.dto.ts`                                                                                                |
| `CONFIRMED` | Runtime statuses include `IN_PROGRESS`, `PAUSED`, `MET`, `BREACHED`, and `CANCELLED`; service tests exercise pause/resume/stop accounting.                                 | `backend-nest/src/itsm/sla/entities/sla-instance.entity.ts`, `backend-nest/src/itsm/sla/sla.service.ts`, `backend-nest/src/itsm/sla/sla.service.spec.ts` |
| `PARTIAL`   | Read models are available, but there is no dedicated externally versioned SLA snapshot/ledger contract correlated to an NVS run.                                           | `backend-nest/src/itsm/sla/sla.controller.ts`                                                                                                            |
| `MISSING`   | No scoped virtual-clock endpoint for an isolated tenant/run was found. A local dry-run script does not establish an external control contract.                             | `backend-nest/src/scripts/sla-clock-parity-dry-run.ts`                                                                                                   |

## Audit, event, and side-effect evidence

| Status      | Finding                                                                                                                                | Evidence                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CONFIRMED` | Tenant audit logs are readable through `GET /audit-logs` with `ADMIN_AUDIT_READ`.                                                      | `backend-nest/src/audit/audit.controller.ts`, `backend-nest/src/audit/entities/audit-log.entity.ts`         |
| `CONFIRMED` | Incident journal entries are readable through `GET /grc/itsm/:table/:recordId/journal`; Incident actions write action journal records. | `backend-nest/src/itsm/journal/journal.controller.ts`, `backend-nest/src/itsm/incident/incident.service.ts` |
| `PARTIAL`   | Domain events are emitted internally, but no stable external HTTP event reader correlated to a validation run was found.               | `backend-nest/src/events`, `backend-nest/src/itsm/incident/incident.service.ts`                             |
| `MISSING`   | `GET /audit/events`, a correlated job reader/await interface, and a notification evidence endpoint were not found.                     | `backend-nest/src/scripts/report-auth-coverage.ts` records the audit-events gap.                            |

Consequently, M1-02 cannot yet claim proof that denied actions are side-effect-free across every required domain.

## Incident UI and browser-test conventions

| Status      | Finding                                                                                                                                                                               | Evidence                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED` | Canonical routes are `/itsm/incidents`, `/itsm/incidents/new`, and `/itsm/incidents/:id`.                                                                                             | `frontend/src/App.tsx`, `backend-nest/src/navigation/navigation-manifest.ts`                                                                         |
| `PARTIAL`   | A legacy `/incidents` route and `IncidentManagement` page remain mounted alongside the canonical ITSM surface.                                                                        | `frontend/src/App.tsx`, `frontend/src/pages/IncidentManagement.tsx`                                                                                  |
| `CONFIRMED` | Canonical stable selectors include `itsm-incident-list`, `incident-create-workspace`, `incident-detail-workspace`, `incident-sticky-actions`, and semantic Incident field/action IDs. | `frontend/src/pages/itsm/ItsmIncidentList.tsx`, `frontend/src/pages/itsm/ItsmIncidentDetail.tsx`, `frontend/src/test-utils/incidentWorkspaceTabs.ts` |
| `PARTIAL`   | Accessibility semantics exist, but Incident tests rely heavily on `data-testid`; no versioned semantic UI manifest was found.                                                         | `frontend/src/pages/itsm`, `frontend/src/components/common/PageShell.tsx`                                                                            |
| `CONFIRMED` | Playwright distinguishes `MOCK_UI` and `REAL_STACK`; frontend configuration includes mock-ui, real-stack, Chromium, and staging projects.                                             | `frontend/playwright.config.ts`, `docs/runbooks/E2E-MODES.md`, `frontend/e2e/helpers.ts`                                                             |
| `PARTIAL`   | Incident mock UI smokes and backend E2E tests exist, but no focused real-stack Incident list-to-detail-to-lifecycle Playwright journey was found.                                     | `frontend/e2e/smoke`, `backend-nest/test/itsm-incidents.e2e-spec.ts`                                                                                 |

Future NILES browser automation should target the canonical `/itsm/incidents` routes and accessibility semantics first, then stable semantic test IDs. M1-01 Playwright exercises the NVS console only.

## Fixture and environment conventions

| Status      | Finding                                                                                                                            | Evidence                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CONFIRMED` | A deterministic default tenant UUID is widely used by tests.                                                                       | `tests/platform-health/helpers.ts`, `backend-nest/test/itsm-incidents.e2e-spec.ts`                                             |
| `CONFIRMED` | `DEMO-SEED-01` is an idempotent, production-blocked demo-data pack with deterministic records.                                     | `backend-nest/src/scripts/demo-seed-01.core.ts`, `backend-nest/test/demo-seed-01.e2e-spec.ts`                                  |
| `PARTIAL`   | Existing seeds are broad demo/test conventions, not an external per-run NVS fixture namespace with inventory and verified cleanup. | `backend-nest/src/scripts`, `tests/product-truth/seeds`                                                                        |
| `PARTIAL`   | Test credentials conflict: one seed path documents `changeme`, while Playwright and backend E2E defaults use `TestPassword123!`.   | `scripts/seed-e2e.sh`, `docs/runbooks/E2E-MODES.md`, `frontend/e2e/helpers.ts`, `backend-nest/test/itsm-incidents.e2e-spec.ts` |
| `UNKNOWN`   | No approved live NILES URL, actor set, tenant scope, or secret-provider binding was available to this implementation task.         | Runtime configuration intentionally not committed.                                                                             |

## NILES testability capability summary

| Capability                                  | Status      | M1 conclusion                                                                    |
| ------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| Environment liveness/readiness              | `CONFIRMED` | Implemented in the M1-01 read-only adapter.                                      |
| Build fingerprint                           | `CONFIRMED` | Endpoint exists; values can remain unknown if deployment metadata is absent.     |
| OpenAPI retrieval                           | `CONFIRMED` | Implemented as an optional M1-01 probe capability.                               |
| Authentication and tenant transport         | `CONFIRMED` | Reserved for M1-02.                                                              |
| Incident CRUD/actions                       | `CONFIRMED` | Reserved for M1-02; reopen/close semantics require reconciliation.               |
| Incident metadata snapshot                  | `MISSING`   | No versioned external snapshot found.                                            |
| Process/state snapshot                      | `PARTIAL`   | Source policy exists; no stable external snapshot and conflicts remain.          |
| Authorization/ownership/tenant snapshot     | `PARTIAL`   | Enforcement exists; no versioned expected-decision model for generated matrices. |
| SLA read models                             | `CONFIRMED` | Useful read endpoints exist.                                                     |
| Versioned SLA snapshot/ledger               | `PARTIAL`   | Existing read models are not the full proposed correlation contract.             |
| Correlated audit                            | `PARTIAL`   | Audit/journal reads exist; least-privilege run correlation is incomplete.        |
| Correlated events/jobs/notifications        | `MISSING`   | No stable external readers/await contract found.                                 |
| Deterministic fixture namespace and cleanup | `PARTIAL`   | Demo seeds exist; per-run external control contract is missing.                  |
| Scoped virtual time                         | `MISSING`   | Required for deterministic breach boundaries after M1-02.                        |
| Stable semantic UI identifiers              | `CONFIRMED` | Present on the canonical Incident UI; a versioned manifest is missing.           |
| Production Class C denial                   | `UNKNOWN`   | No coherent NVS testability-control surface exists to verify this boundary.      |

## Binding M1 decisions

1. NVS may call only the confirmed read-only probe routes through configurable environment paths.
2. Missing optional OpenAPI or build metadata is reported as unavailable, not as a crash or an inferred value.
3. Failed, degraded, or unclassifiable required readiness produces `BLOCKED`.
4. Compile-only runs perform no Incident, SLA, identity, fixture, or cleanup mutation.
5. All unstable NILES transport details remain isolated in `packages/adapter-niles`.
6. Unknown and missing capabilities above become prerequisites or explicit blockers; they are never interpreted as passing behavior.
7. M1-02B live mutation is limited to `payment-api-service-degradation` with `journey=normal`, and only after non-production, policy, server-switch, fixture, actor, allowlist, confirmation, and concurrency gates pass.
8. Close-authority unsatisfiability remains `BLOCKED`; verified run-owned soft delete is cleanup evidence, not a release PASS.

## M1 backlog

- Reconcile policy and service behavior for reopen target state and closure authority before expanding live assertions.
- Approve distinct least-privilege actor profiles and tenant mappings without committing credentials.
- Define an isolated per-run fixture namespace, inventory, cleanup, and cleanup-verification contract.
- Expose or approve versioned Incident metadata, state/transition, and expected authorization declarations.
- Define correlation propagation and least-privilege readers for state, audit, events, jobs, notifications, and SLA evidence.
- Implement the authenticated Incident API adapter only after the preceding contracts are testable.
- Prove denied operations have no observable unauthorized side effects; unavailable evidence must remain `BLOCKED`.
- Preserve a virtual-time seam for M1-03; do not accelerate or directly force SLA outcomes in M1-02.
