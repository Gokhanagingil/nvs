# NVS M1 Product Delivery Plan — 2026-07-14

> Status: Product Owner direction accepted
> Starting point: M1-01 merged in PR #4
> Governing milestone: Issue #2
> Immediate slice: Issue #5 — M1-02A

## Outcome commitment

NVS will be advanced through five focused implementation slices rather than one oversized PR. The intended outcome after M1-05 is a credible internal product that can be deployed, operated from a web console, execute realistic NILES Incident validation through API and selected UI paths, produce trustworthy evidence, schedule suites, and support AI-assisted scenario authoring without allowing AI to become the release oracle.

The five slices are:

1. **M1-02A — Deployable foundation and actor sessions**
2. **M1-02B — Real Incident API happy path**
3. **M1-03 — Authorization, tenant isolation, negative paths, and SLA evidence**
4. **M1-04 — NILES browser journeys, API/UI parity, and operator-grade run UX**
5. **M1-05 — AI-assisted scenario generation, scheduled suites, release gates, and product hardening**

The plan is intentionally aggressive. Each slice must deliver a working vertical outcome and must not become a broad platform rewrite.

## Cross-slice product decisions

### NILES-first delivery

NVS remains adapter-based, but no hypothetical multi-product abstraction may delay the NILES implementation. A second target is added only after the NILES validation workflow is useful and stable.

### Synthetic test identities

NVS uses dedicated synthetic users in approved non-production NILES environments. Real employee, customer, or production identities are not used for validation runs.

Each semantic actor receives an independent real NILES login/session. NVS does not use impersonation as the primary authorization-test mechanism. It does not repeatedly log out and back in between business steps; actor sessions remain isolated and in memory for the run lifetime.

### Deterministic release core

PASS, FAIL, and BLOCKED remain deterministic outcomes based on versioned contracts and observed evidence. AI may propose or critique scenarios and explain failures, but it cannot silently change expectations or decide a release result by itself.

### Deployment early

CI, immutable packaging, and repeatable staging deployment are part of M1-02A, not a post-product cleanup. A feature that cannot be deployed and operated repeatably is not considered complete.

### Production safety

M1 validation capabilities are non-production only. Production environments may be probed read-only where explicitly allowed, but authentication preflights, fixtures, mutation, virtual time, cleanup controls, or scenario execution are forbidden until a later separately approved operating model exists.

---

## Slice 1 — M1-02A: Deployable foundation and actor sessions

### Business outcome

NVS becomes an installable and manually deployable staging application. Operators can verify environment connectivity and readiness of configured synthetic actors without exposing credentials or mutating NILES business records.

### Minimum scope

- Single immutable production image serving API and built web console.
- Docker Compose staging package and bootstrap runbook.
- Full CI plus production-image build validation.
- Manual GitHub Actions staging deployment for an exact commit/image.
- Health, readiness, and build fingerprint for NVS itself.
- Versioned actor-profile and environment mapping contracts.
- Replaceable secret-provider port with environment-variable implementation.
- Independent NILES login sessions for configured actors.
- Authentication preflight API and UI.
- MFA, missing credentials, denied login, malformed response, timeout, and production-target attempts classified as BLOCKED.

### Non-goals

- Incident mutation.
- User or tenant creation on shared staging.
- NILES UI automation.
- Public production exposure.

### Exit signal

A merged commit can be built, deployed, health-verified, and rolled back through a workflow. The deployed console can report whether each configured synthetic actor is missing, configured, or successfully authenticated, while persisting no credential or token.

---

## Slice 2 — M1-02B: Real Incident API happy path

### Business outcome

An operator launches the Payment API Service Degradation scenario from NVS and NVS executes a real Incident API journey in an approved NILES test tenant.

### Minimum scope

- Run-scoped fixture namespace and inventory.
- Approved primary tenant and actor mappings.
- Incident creation, detail read, assignment, ownership/start work, hold, resume, resolve, and the accepted close behavior.
- State and field assertions after every step.
- SLA attach/read, pause/resume, and completion observations where current NILES surfaces support them.
- Correlation ID propagation.
- Sanitized request/response and state evidence.
- Verified cleanup or explicit retained-on-failure policy.
- UI run progress using real runtime step states.

### Scope rule

Reopen is excluded until NILES policy and implementation semantics are reconciled. Full breach acceleration and virtual time remain later work.

### Exit signal

A real Incident happy path can be executed repeatedly in an isolated test scope, produces a complete evidence bundle, and leaves either verified-clean state or an explicitly retained diagnostic record.

---

## Slice 3 — M1-03: Authorization, tenant isolation, negative paths, and SLA evidence

### Business outcome

NVS becomes useful for security-sensitive UAT rather than only happy-path regression.

### Minimum scope

- Unauthenticated denial.
- Insufficient-role denial for agent-only actions.
- Cross-tenant read and mutation denial.
- Invalid transition and missing-evidence variants.
- Separate actor sessions and tenant headers.
- Before/after state proof for denied actions.
- Observable journal, audit, and SLA side-effect checks.
- BLOCKED when a required evidence domain is unavailable.
- Coverage matrix updated with executed cells.

### Exit signal

NVS detects and explains authorization, transition, and tenant-isolation regressions with evidence strong enough to support release decisions for the covered scope.

---

## Slice 4 — M1-04: NILES browser journeys and operator-grade run UX

### Business outcome

NVS validates that critical capabilities are usable from the NILES UI and that UI outcomes agree with API outcomes.

### Minimum scope

- Playwright runner behind a dedicated adapter.
- Actor-specific isolated BrowserContext sessions.
- Canonical Incident routes and semantic locators/test IDs.
- Selected create/detail/ownership/hold-resume/resolve journey.
- API setup with UI verification where that reduces fragility.
- API/UI parity assertions.
- Screenshots, traces, console/network diagnostics.
- Live run progress, cancellation, retry rules, and clearer failure classification in the NVS console.

### Exit signal

A critical Incident journey runs through the actual NILES UI and produces correlated browser/API evidence without duplicating every API test in the browser.

---

## Slice 5 — M1-05: AI assistance, scheduling, release gates, and product hardening

### Business outcome

NVS operates as a small digital ITSM validation team rather than a collection of manually maintained scripts.

### Minimum scope

- AI-assisted scenario proposal from approved NILES sources.
- Separate scenario critic and variation generator roles.
- Human review/approval workflow for generated scenario changes.
- Prompt/model/provenance recording without confidential inputs.
- Scheduled/nightly suite execution.
- Release-candidate targeting and build-SHA evidence.
- Release-gate policy with PASS/FAIL/BLOCKED summary.
- Notifications for completed or failed suites.
- Retention, artifact cleanup, operational diagnostics, and backup guidance.
- UI modularization and production hardening.

### Exit signal

NVS is deployed, can run scheduled and on-demand Incident validation suites, explains failures, presents coverage and evidence, and can be incorporated into the NILES release process as an internal product.

---

## Delivery governance

Each slice uses a separate issue, branch, focused PR, CI run, and architecture review. A slice may add small NILES-side testability changes only in the `grc` repository through a separate explicitly approved PR; NVS implementation branches never modify `grc`.

A slice is complete only when:

- local and remote CI are green;
- the user-visible path works end to end;
- security boundaries and non-goals are preserved;
- evidence is trustworthy and no uncertainty is converted into PASS;
- deployment/runbook impact is documented;
- follow-up risks are recorded rather than hidden.
