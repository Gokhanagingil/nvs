# NVS Decision Log

> **Last updated:** 2026-07-14  
> **Authority:** Product Owner approval is required for material product and architecture decisions

## Status definitions

- **Accepted** — explicitly agreed and currently binding.
- **Proposed** — recommended for review; not implementation authority.
- **Rejected** — considered and intentionally not selected.
- **Deferred** — valid question or capability postponed to a later gate.
- **Superseded** — replaced by a later decision, with linkage.

## Accepted decisions

### DEC-001 — Establish NVS as a separate repository

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** Use `Gokhanagingil/nvs` as the repository for NVS discovery and, if authorized, implementation.
- **Rationale:** NVS is independently deployable and should have a separate lifecycle from the NILES product.
- **Consequences:** NILES-side changes remain in the appropriate NILES repositories and are referenced through explicit contracts/ADRs.

### DEC-002 — Begin with product discovery, not production code

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** Complete market research, product boundary, architecture options, MVP, and decision gates before production implementation.
- **Rationale:** The category already contains mature tools; premature coding could duplicate infrastructure or lock in a weak architecture.
- **Consequences:** D1–D3 block production code. Disposable architecture spikes require explicit authorization.

### DEC-003 — Keep NVS externally deployable

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** NVS is designed as an external system connected to NILES rather than only an embedded NILES test harness.
- **Rationale:** External validation provides independence, a separate failure domain, and black-box verification of supported boundaries.
- **Consequences:** NILES still needs a minimal, secure testability contract. Normal unit/component/service tests remain inside NILES.

### DEC-004 — Start with Incident and SLA

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** Incident is the first process; SLA behavior is part of the same initial vertical slice.
- **Rationale:** This combination exercises process, state, time, assignment, metadata, API, UI, and side-effect behavior.
- **Consequences:** Request, Change, CMDB, and other modules are deferred until the first slice is validated.

### DEC-005 — Include roles and authorization in the first slice

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** Role and permission scenarios are first-class MVP scope and are not deferred to UI-only testing.
- **Rationale:** Security enforcement begins at the API/service boundary. UI visibility alone cannot prove authorization.
- **Consequences:** The MVP requires distinct actor identities and positive, horizontal, vertical, property, ownership, and tenant variants where applicable.

### DEC-006 — Minimize manual scenario authoring

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** NVS should derive tests from OpenAPI, metadata, process/state models, policies, recorded journeys, and reviewed AI proposals rather than rely on a manually scripted library.
- **Rationale:** Manual end-to-end suites scale poorly and become expensive to maintain.
- **Consequences:** Business invariants still require human ownership; generation cannot invent the intended business outcome.

### DEC-007 — Documentation and decision history are repository artifacts

- **Status:** Accepted
- **Date:** 2026-07-14
- **Decision:** Maintain the charter, research, architecture, MVP, testability contract, decisions, and future ADRs in Git.
- **Rationale:** The team needs to know not only what was chosen, but why.
- **Consequences:** Difficult-to-reverse choices require an ADR and reviewable change.

## Proposed decisions for D1–D3 approval

### DEC-008 — Position NVS as an internal NILES release-assurance capability first

- **Status:** Proposed
- **Gate:** D1
- **Decision:** Prove NVS inside the NILES release process before treating it as a separate commercial product.
- **Rationale:** The immediate value is reduced go-live and regression risk. Commercialization before internal proof would distract from NILES quality and hide maintenance economics.
- **Alternatives:** Build as a commercial multi-product platform immediately; build only disposable NILES scripts.
- **Recommendation:** Accept.

### DEC-009 — Define the differentiation as NILES semantic validation and evidence

- **Status:** Proposed
- **Gate:** D1
- **Decision:** NVS differentiates through compilation and validation of NILES metadata, process state, SLA, roles, ownership, tenant boundaries, and side effects—not generic AI test automation.
- **Rationale:** Browser automation, recorders, API runners, AI authoring, healing, and generic triage already exist.
- **Recommendation:** Accept.

### DEC-010 — Compose mature execution engines

- **Status:** Proposed
- **Gate:** D2
- **Decision:** Build a NILES-aware orchestrator and reuse mature runners behind adapters.
- **Initial candidates:** Playwright for UI, Schemathesis for OpenAPI property testing, optional Pact/k6/security adapters later.
- **Rationale:** Custom value is in the semantic model, generators, oracles, coverage, and evidence.
- **Recommendation:** Accept, subject to architecture spike and dependency due diligence.

### DEC-011 — Use deterministic release oracles; keep AI advisory

- **Status:** Proposed
- **Gate:** D2
- **Decision:** Approved contracts, models, invariants, and observable post-conditions determine pass/fail. AI may propose, explain, classify, and draft reviewed changes.
- **Rationale:** AI output can be nondeterministic or unsupported and should not silently change release meaning.
- **Consequences:** AI provider is replaceable; prompts/models are recorded when used; no sole-source AI release verdict.
- **Recommendation:** Accept.

### DEC-012 — Store semantic scenarios independently of runner mechanics

- **Status:** Proposed
- **Gate:** D2
- **Decision:** Scenarios express actions such as `incident.resolve`, while adapters implement concrete HTTP or Playwright behavior.
- **Rationale:** This preserves scenario intent across UI layout, API implementation, and engine changes.
- **Recommendation:** Accept.

### DEC-013 — Require a versioned NILES testability contract

- **Status:** Proposed
- **Gate:** D2
- **Decision:** NILES exposes the minimum safe declarations, deterministic non-production controls, synchronization, and correlated evidence required by NVS.
- **Rationale:** Hidden workflow and SLA effects cannot be validated reliably from clicks and response codes alone.
- **Recommendation:** Accept only after demonstration against the actual NILES architecture.

### DEC-014 — Use API-first authorization matrices with selected UI checks

- **Status:** Proposed
- **Gate:** D2/D3
- **Decision:** Generate actor/action/resource/property/ownership/tenant combinations at the API boundary; use UI tests to confirm user-facing availability and consistency.
- **Rationale:** UI hiding is not a security control.
- **Recommendation:** Accept.

### DEC-015 — Require virtual time or an explicit deterministic SLA fallback

- **Status:** Proposed
- **Gate:** D2
- **Decision:** SLA tests use a scoped virtual clock that drives the real SLA logic. If impossible, document and approve a lower-level harness plus limited real-time end-to-end confirmation.
- **Rationale:** Wall-clock SLA suites are slow and flaky; directly forcing SLA status would bypass the behavior under test.
- **Recommendation:** Accept.

### DEC-016 — Use accessibility semantics and stable UI test identifiers

- **Status:** Proposed
- **Gate:** D2
- **Decision:** Resolve UI intent through role/name/label first and a stable metadata-derived attribute such as `data-nvs` when needed. Avoid coordinates and deep CSS/XPath.
- **Rationale:** Semantic contracts survive non-semantic layout changes and improve accessibility discipline.
- **Recommendation:** Accept.

### DEC-017 — Start with a CLI and file-based artifacts

- **Status:** Proposed
- **Gate:** D2/D3
- **Decision:** The MVP uses a CLI, standard exit codes, JSON/JUnit evidence, Playwright traces, and local/CI artifact directories. Database, web console, distributed scheduling, and long-term analytics are deferred.
- **Rationale:** The product hypothesis concerns model/oracle/evidence quality, not platform UI or infrastructure.
- **Recommendation:** Accept.

### DEC-018 — Propose TypeScript for the control plane

- **Status:** Proposed
- **Gate:** D2
- **Decision:** Use TypeScript/Node.js for the orchestrator and Playwright adapter during the spike; invoke Schemathesis through a pinned CLI/container adapter.
- **Rationale:** First-class Playwright ecosystem, typed schemas, portable CLI, and simple CI integration.
- **Risk:** Polyglot adapter boundary and Node/Python dependency management.
- **Recommendation:** Validate in spike before final acceptance.

### DEC-019 — Use a small curated invariant set plus generated variants

- **Status:** Proposed
- **Gate:** D3
- **Decision:** Do not define the MVP as 30–50 manually scripted E2E tests. Maintain a smaller semantic template/invariant library and generate contract, state, role, ownership, tenant, and time variants.
- **Rationale:** This targets maintainability and measurable semantic coverage.
- **Recommendation:** Accept.

### DEC-020 — Use PASS / FAIL / BLOCKED release outcomes

- **Status:** Proposed
- **Gate:** D3
- **Decision:** `PASS` requires complete evidence and cleanup; deterministic product violations are `FAIL`; uncertainty about environment, model, evidence, credentials, cleanup, or nondeterminism is `BLOCKED`.
- **Rationale:** Unexecuted or uncertain tests must never improve the release verdict.
- **Recommendation:** Accept.

## Rejected directions

### DEC-021 — Build a custom browser automation engine

- **Status:** Rejected
- **Reason:** Mature engines already provide locators, recording, traces, reports, and browser compatibility.

### DEC-022 — Treat UI tests as sufficient authorization proof

- **Status:** Rejected
- **Reason:** Hidden/disabled UI controls can be bypassed by direct API calls; enforcement belongs at the service boundary.

### DEC-023 — Let an LLM autonomously decide pass/fail

- **Status:** Rejected
- **Reason:** Release outcomes require deterministic, reviewable, versioned oracles and evidence.

### DEC-024 — Silently self-heal release-gating tests

- **Status:** Rejected
- **Reason:** Silent healing can normalize a genuine product regression or change expected behavior without approval.

### DEC-025 — Depend on screen coordinates or deep DOM selectors

- **Status:** Rejected
- **Reason:** These encode layout rather than intent and create unstable tests.

### DEC-026 — Wait for SLA behavior using long real-time sleeps as the main strategy

- **Status:** Rejected
- **Reason:** Slow and nondeterministic; does not scale to boundary coverage.

### DEC-027 — Expose production mutation controls for convenience

- **Status:** Rejected
- **Reason:** Fixture reset, virtual time, and job controls create unacceptable production risk.

### DEC-028 — Build a web console and database before proving the validator

- **Status:** Rejected for MVP
- **Reason:** Adds platform work without validating the core semantic model, oracle, and evidence hypothesis.

## Deferred decisions

### DEC-029 — Adopt GraphWalker versus implement a minimal path planner

- **Status:** Deferred
- **Gate:** D2 spike
- **Decision needed:** Compare integration complexity, path generation, reproducibility, shrinking, and model fit.

### DEC-030 — Select long-term artifact and analytics storage

- **Status:** Deferred
- **Gate:** Post-MVP
- **Reason:** File artifacts are sufficient to prove the first release-gating workflow.

### DEC-031 — Add contract, performance, accessibility, and security runners

- **Status:** Deferred
- **Gate:** Post-MVP
- **Reason:** Valuable but outside the Incident/SLA functional vertical slice.

### DEC-032 — Commercialize NVS

- **Status:** Deferred
- **Gate:** After internal MVP outcomes
- **Decision inputs:** defect detection, release-risk reduction, maintenance cost, customer demand, deployment/security model, support burden, and differentiation.

### DEC-033 — Use a hosted AI testing or diagnosis service

- **Status:** Deferred
- **Gate:** Post-security/data-governance review
- **Reason:** Product data, metadata, traces, and credentials require explicit handling and retention controls.

## Decisions requiring Product Owner review now

For the next gate, review and accept/revise/reject:

- DEC-008 — internal release assurance first;
- DEC-009 — NILES semantic differentiation;
- DEC-010 — compose mature engines;
- DEC-011 — deterministic AI boundary;
- DEC-012 — semantic scenario IR;
- DEC-013 — testability contract;
- DEC-014 — API-first authorization;
- DEC-015 — virtual SLA time;
- DEC-016 — semantic UI contract;
- DEC-017 — CLI/file MVP;
- DEC-018 — TypeScript spike;
- DEC-019 — curated templates plus generated variants;
- DEC-020 — PASS/FAIL/BLOCKED policy.

## Decision record template

Future entries should include:

```markdown
### DEC-NNN — Title

- **Status:** Proposed | Accepted | Rejected | Deferred | Superseded
- **Date:** YYYY-MM-DD
- **Owner:**
- **Gate:**
- **Context:**
- **Decision:**
- **Alternatives:**
- **Rationale:**
- **Consequences:**
- **Validation:**
- **Supersedes / Superseded by:**
```
