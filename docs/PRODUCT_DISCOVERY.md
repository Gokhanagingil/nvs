# NVS Product Discovery

> **Status:** Proposed for Product Owner review  
> **Date:** 2026-07-14  
> **Decision gate:** D1 — Problem and differentiation  
> **Initial NILES scope:** Incident + SLA + authorization

## 1. Executive conclusion

The discovery recommendation is to **continue into a constrained architecture spike**, but not yet into full product implementation.

The idea is worth pursuing only under a narrow definition:

> NVS is a NILES-aware validation orchestrator and release-evidence system. It is not a new browser driver, generic API test runner, or generic AI testing platform.

The market already provides mature execution engines and increasingly capable AI-assisted test products. The unsolved NVS-specific problem is not “how to click a button” or “how to send an HTTP request.” It is how to determine, with reproducible evidence, whether a NILES action produced the correct process outcome across state, SLA, metadata, authorization, ownership, tenant, audit, event, and UI boundaries.

The current recommendation is therefore:

- build the **NILES semantic compiler, orchestration, coverage, and evidence layers**;
- compose existing API and UI execution engines;
- require a small, security-reviewed NILES testability contract;
- use AI to propose and explain, never as the sole release oracle;
- prove NVS as an internal NILES release gate before considering it a separate commercial product.

## 2. Origin and context

NILES is approaching go-live preparation. The current product direction is intentionally conservative:

- P0 defects have been addressed and P1 work continues;
- broad feature expansion is paused;
- configurable list columns and spreadsheet export are considered near-term user necessities;
- a full reporting module can be deferred to a later phase;
- stability, rigorous UAT, and metadata integrity are primary release concerns.

The validation discussion identified a need for testing beyond happy paths. The first target is Incident because it exercises several platform-critical concerns at once:

- record creation and field rules;
- assignment and ownership;
- process state transitions;
- SLA start, pause, resume, stop, and breach behavior;
- role and permission enforcement;
- API and UI consistency;
- observable side effects such as audit records, events, notifications, or background jobs.

NVS is proposed as an external system so that the product does not rely entirely on its own internal mechanisms to certify itself.

## 3. Product question

The central question is not:

> Can we automate NILES tests?

That question is already solved by many tools.

The central question is:

> Can we automatically derive and maintain enough NILES-specific validation logic to make release decisions materially safer than manual UAT and generic automation alone?

The answer depends on three difficult capabilities:

1. **A trustworthy behavioral model** derived from NILES contracts, metadata, process definitions, and access policies.
2. **A trustworthy oracle** that distinguishes a correct business result from a superficially successful action.
3. **A trustworthy evidence chain** that explains the result and makes it reproducible.

Execution technology is important, but it is not the principal innovation.

## 4. Intended users and jobs

### 4.1 Product Owner / Release Owner

**Job:** Decide whether a NILES build is safe to promote.

NVS should answer:

- Which critical process, SLA, and authorization invariants passed?
- What changed since the last accepted build?
- Are failures product defects, test defects, or environment defects?
- Which risks remain untested?
- Is the evidence sufficient to approve the release?

### 4.2 Developer

**Job:** Reproduce and fix a regression quickly.

NVS should provide:

- the exact environment, build, metadata, and policy fingerprint;
- the actor and tenant used;
- deterministic fixture inputs;
- the executed semantic steps and generated variants;
- API requests and responses with secrets redacted;
- state, audit, event, and SLA evidence;
- a Playwright trace for UI failures;
- a minimal reproducer where possible.

### 4.3 QA / Quality Engineer

**Job:** Design risk-based coverage without manually writing every test case.

NVS should show coverage by:

- process state and transition;
- role, permission, ownership, and tenant boundary;
- endpoint and schema constraint;
- metadata field, rule, and version;
- SLA event and time boundary;
- critical UI action and visibility rule;
- business invariant.

### 4.4 NILES Implementation or Configuration Owner

**Job:** Confirm that a configured environment still respects platform invariants.

NVS should detect:

- configuration drift;
- missing or inconsistent metadata;
- role-policy changes;
- process definitions that contain unreachable or unsafe paths;
- SLA definitions whose behavior differs from their declared model;
- environment-specific regressions.

### 4.5 Future Auditor or Customer Assurance Role

This is not an MVP user, but the evidence model should not prevent later use for release attestations or customer-environment validation. Any such use requires a separate security, privacy, and operating model.

## 5. The six product capabilities

### 5.1 Discovery

NVS must discover what can be validated from versioned, machine-readable sources:

- OpenAPI contracts;
- NILES metadata snapshots;
- process and state models;
- role and permission policies;
- entity relationships and ownership rules;
- SLA definitions and calendars;
- semantic UI identifiers;
- environment and build fingerprints.

Discovery must report uncertainty. An undocumented rule is not silently treated as absent.

### 5.2 Generation

NVS should generate deterministic test candidates from the discovered model:

- valid and invalid API payloads;
- boundary values and omitted mandatory fields;
- allowed and forbidden state transitions;
- role/action/resource combinations;
- same-role cross-user ownership checks;
- cross-role and cross-tenant checks;
- SLA time-boundary cases;
- metadata integrity checks;
- selected process paths meeting a declared coverage goal.

Generation reduces manual volume. It does not eliminate the need to define business invariants.

### 5.3 Execution

NVS orchestrates execution through adapters:

- API runner;
- browser runner;
- model/path runner;
- optional contract, performance, security, and accessibility runners in later phases.

The same semantic action may have API and UI implementations. API execution proves enforcement and behavior at the service boundary; selected UI execution proves that the intended user can or cannot complete the action through the real interface.

### 5.4 Oracle

A test oracle determines whether an outcome is correct.

NVS oracles should be drawn from explicit sources, in descending order of authority:

1. approved business invariants;
2. approved state, SLA, and authorization models;
3. versioned API and metadata contracts;
4. observable post-conditions and side effects;
5. approved snapshots or baselines;
6. AI-generated suggestions that have been reviewed and promoted into one of the sources above.

An LLM response is not itself a pass/fail oracle.

### 5.5 Evidence

Each run should produce an evidence bundle containing, as applicable:

- scenario and generator versions;
- environment, NILES build, metadata, and policy fingerprints;
- actor, role, ownership, and tenant context;
- seeded fixture identifiers;
- semantic steps and concrete adapter actions;
- redacted API request/response data;
- state before and after each important action;
- audit, event, job, notification, and SLA ledger entries;
- UI trace, screenshot, console, and network evidence;
- assertion results and failure classification;
- cleanup result.

### 5.6 Coverage

NVS must not report only a test count. One hundred similar happy-path tests can still leave the important risks untouched.

Coverage dimensions should include:

- state coverage;
- transition coverage;
- forbidden-transition coverage;
- role/action/resource coverage;
- horizontal, vertical, unauthenticated, and cross-tenant authorization coverage;
- endpoint and operation coverage;
- request/response schema-constraint coverage;
- metadata-rule coverage;
- SLA lifecycle and time-boundary coverage;
- business-invariant coverage;
- critical UI-action coverage.

## 6. How scenarios should be acquired

A fully manual test library is rejected. A fully autonomous AI-generated library is also rejected.

NVS should use a layered acquisition model.

### Layer A — Contract-derived tests

Inputs:

- OpenAPI schema;
- request and response definitions;
- declared authentication requirements;
- declared examples and constraints.

Generated output:

- schema conformance;
- valid and invalid payload variants;
- missing, null, boundary, enum, format, and type cases;
- response status and schema checks;
- undocumented response detection.

This layer is highly automatable but does not know NILES business meaning by itself.

### Layer B — Metadata-derived tests

Inputs:

- field metadata;
- mandatory, visibility, editability, default, and reference rules;
- state definitions;
- action definitions;
- role and permission metadata;
- tenant and ownership policies;
- SLA declarations.

Generated output:

- field and action invariants;
- API/UI consistency checks;
- positive and negative role variants;
- metadata integrity checks;
- candidate process and SLA assertions.

This layer is the first major NVS-specific differentiator.

### Layer C — Model-based process tests

Inputs:

- state graph;
- transition guards;
- actions;
- post-conditions;
- role constraints;
- coverage target.

Generated output:

- paths through the process model;
- short reproducing paths for a failure;
- state and transition coverage reports;
- invalid transition attempts;
- concurrency and ordering candidates where explicitly modeled.

The model must remain understandable and versioned. State-space control is mandatory.

### Layer D — Recorded journeys lifted to semantics

A recorder may capture a real user flow, but the stored result should not remain a brittle sequence of coordinates or DOM paths.

The recorder should translate concrete actions into semantic steps such as:

- `incident.create`;
- `incident.assign`;
- `incident.resolve`;
- `sla.assert_running`;
- `authorization.assert_action_hidden`.

The generated scenario is reviewed, parameterized, and connected to deterministic assertions before becoming a release-gating test.

### Layer E — AI-assisted proposals

AI may:

- propose scenarios from requirements, diffs, defects, and uncovered model areas;
- suggest boundary and negative cases;
- classify likely failure causes;
- summarize evidence;
- propose a test update as a visible diff.

AI may not:

- silently change a release-gating assertion;
- silently heal a selector or expected outcome;
- declare a release safe without deterministic evidence;
- invent missing NILES behavior and present it as fact.

## 7. Differentiation thesis

NVS is defensible only if it creates value above the underlying tools.

### 7.1 What is not differentiating

- browser recording;
- resilient element location;
- API request execution;
- schema validation;
- CI scheduling;
- screenshots and video;
- generic natural-language test authoring;
- generic AI failure summaries;
- generic self-healing selectors.

These capabilities already exist and should be reused or treated as commodity infrastructure.

### 7.2 Potential NVS differentiation

1. **NILES semantic compilation**  
   Convert NILES metadata, process definitions, SLA definitions, and policies into one executable validation model.

2. **Cross-layer business oracles**  
   Validate not only the visible result but also state, audit, events, background jobs, SLA ledger, ownership, and tenant isolation.

3. **Generated authorization matrices**  
   Automatically test positive and negative role/action/resource combinations, including same-role cross-user access and cross-tenant access.

4. **Deterministic SLA time control**  
   Validate start, pause, resume, stop, breach, calendar, and boundary behavior without waiting for wall-clock time.

5. **NILES-native coverage**  
   Measure coverage in process, policy, metadata, and SLA terms rather than only files, endpoints, or screens.

6. **Independent release evidence**  
   Produce a signed or hashed evidence bundle that can be compared across builds and environments.

7. **Configuration-aware validation**  
   Recompile scenarios when metadata changes and explain which coverage or expected behavior changed.

## 8. Why an external system is valuable

An external validator provides:

- an independent failure domain;
- black-box verification of public boundaries;
- the ability to test a partially degraded NILES instance;
- separate lifecycle and release cadence;
- reusable release gates across environments;
- reduced risk that the same defect exists in both product logic and its internal test mechanism.

However, “external” does not mean “uninstrumented.” Enterprise workflows contain hidden state and asynchronous effects. NVS requires read-only evidence and controlled non-production test operations from NILES.

The correct boundary is:

- NVS initiates real actions through real product interfaces;
- NILES exposes trustworthy observations and safe deterministic controls;
- test-only controls do not bypass the authorization or business behavior under test;
- dangerous controls are unavailable in production.

## 9. Build, buy, compose, or stop

### 9.1 Build everything

**Recommendation:** Reject.

Rebuilding a browser engine, API fuzzing engine, trace viewer, report framework, and CI runner would consume effort without creating NILES-specific value.

### 9.2 Buy a generic AI testing platform

**Recommendation:** Evaluate only as an execution adapter or benchmark.

A generic platform may accelerate UI authoring and maintenance, but it will not automatically become the authoritative source for NILES metadata, SLA, roles, ownership, tenant isolation, or process invariants. It may also introduce data-governance, vendor-lock-in, and opaque-healing concerns.

### 9.3 Embed all testing inside NILES

**Recommendation:** Reject as the sole strategy; allow complementary internal tests.

Unit and component tests belong inside NILES. The release validator should remain independently deployable and capable of exercising public boundaries.

### 9.4 Compose mature engines behind a NILES-aware control plane

**Recommendation:** Preferred.

Build only:

- model ingestion and normalization;
- NILES semantic scenario representation;
- generators and planners;
- orchestration and adapter contracts;
- NILES-specific assertions and coverage;
- evidence normalization and release policy.

Reuse:

- browser automation and tracing;
- OpenAPI property testing;
- contract testing;
- performance runners;
- security scanners;
- standard report formats.

### 9.5 Stop

Stopping remains correct if the architecture spike shows that:

- NILES cannot expose a trustworthy and secure testability contract;
- SLA and asynchronous behavior cannot be made deterministic enough for reliable gating;
- metadata is not sufficiently authoritative to generate valid expectations;
- the maintenance cost of the semantic model is comparable to manually maintaining the tests;
- an existing solution can satisfy the required NILES semantics and evidence without a custom control plane.

## 10. Highest-risk assumptions

| ID | Assumption | Why it matters | Validation method |
|---|---|---|---|
| A1 | NILES can export a versioned metadata snapshot. | Metadata-derived generation depends on it. | Build a read-only snapshot prototype and compare it with runtime behavior. |
| A2 | Process transitions and guards are machine-readable or derivable. | Model-based path generation needs a trustworthy graph. | Compile the Incident state model and reconcile every transition with observed API behavior. |
| A3 | SLA time can be controlled safely in a test environment. | Wall-clock tests are slow and flaky. | Demonstrate virtual-time advance across start, pause, resume, and breach boundaries. |
| A4 | Background work can be correlated and awaited. | Eventual consistency otherwise produces nondeterministic assertions. | Introduce correlation IDs and a bounded “drain/await” mechanism for test environments. |
| A5 | Role, ownership, and tenant policies can be enumerated. | Generated authorization testing needs expected allow/deny outcomes. | Export a policy matrix and compare it with direct API checks using multiple identities. |
| A6 | Critical UI actions can expose stable semantics. | UI tests must survive layout refactors. | Add accessibility-first locators and stable semantic test IDs to one Incident journey. |
| A7 | Test data can be isolated and reset. | Repeatability and safety depend on it. | Seed and clean an isolated tenant or namespace three times with identical outcomes. |
| A8 | Observable evidence is sufficient to classify failures. | A red test without diagnosis will not build release trust. | Run induced product, test, and environment failures and verify classification. |

## 11. Discovery experiments

### E1 — Metadata-to-test compilation

Select the Incident entity and compile:

- fields and constraints;
- actions;
- state model;
- role rules;
- version fingerprint.

Generate a small deterministic test set and compare expected behavior with the running system.

**Pass signal:** The generated tests are materially useful and require less maintenance than hand-authoring equivalent coverage.

### E2 — Authorization matrix

Use at least:

- unauthenticated actor;
- requester A;
- requester B with the same role;
- service desk or resolver role;
- administrator;
- actor in a different tenant, if multi-tenancy applies.

Exercise selected create, read, update, assign, resolve, and delete or equivalent actions.

**Pass signal:** NVS can distinguish allowed, horizontal, vertical, and cross-tenant cases with deterministic evidence.

### E3 — SLA virtual time

Create an Incident that starts an SLA. Advance controlled time across:

- start;
- pause;
- resume;
- warning boundary if configured;
- breach boundary;
- stop or completion.

**Pass signal:** The same scenario produces identical SLA evidence across repeated runs without real waiting.

### E4 — Semantic UI journey

Automate one critical Incident journey using accessibility roles and stable semantic identifiers, not CSS/XPath structure.

Refactor layout without changing business semantics.

**Pass signal:** The test remains valid or produces a small, explainable adapter change rather than a rewritten scenario.

### E5 — Evidence and failure classification

Induce separately:

- a real product defect;
- a stale expectation;
- an unavailable dependency or broken environment;
- a transient browser issue.

**Pass signal:** The evidence bundle makes the classes distinguishable and never silently converts uncertainty into success.

## 12. Product risks and controls

### False confidence

**Risk:** Generated volume creates an illusion of coverage.

**Control:** Report semantic coverage and unresolved model gaps; never use test count as the primary quality measure.

### Oracle drift

**Risk:** Metadata and expected behavior drift together and a defect is encoded as the new expectation.

**Control:** Version models, require review for invariant changes, compare behavior across builds, and maintain selected independent golden invariants.

### State explosion

**Risk:** Combining fields, states, roles, tenants, and time creates an unbounded scenario space.

**Control:** Pairwise/risk-based selection, explicit path generators, bounded coverage goals, and failure shrinking.

### Flakiness from asynchronous behavior

**Risk:** Arbitrary sleeps lead to nondeterministic results.

**Control:** Correlation, observable job completion, bounded polling on domain conditions, and virtual time.

### Security exposure

**Risk:** A powerful test identity or reset/time-control endpoint becomes an attack path.

**Control:** non-production-only controls, network isolation, short-lived scoped credentials, explicit environment allowlists, audit, and production kill switches.

### AI hallucination or overreach

**Risk:** AI invents behavior, changes expectations, or hides regressions through healing.

**Control:** AI proposals are reviewable diffs; deterministic assertions and approved models own pass/fail decisions.

### Tight coupling

**Risk:** Every NILES refactor forces NVS changes.

**Control:** stable versioned contracts, semantic adapters, a normalized intermediate model, and compatibility tests for the connector.

### Productization distraction

**Risk:** Building a commercial testing product delays NILES go-live quality work.

**Control:** internal release-assurance success is the only near-term product objective.

## 13. D1 recommendation

**Recommendation to the Product Owner:** Approve D1 provisionally and authorize the architecture/testability spike defined in E1–E5.

The research supports the existence of a meaningful problem, but it also shows that generic test automation and AI test authoring are crowded capabilities. NVS should proceed only as a narrow, domain-aware layer that composes existing engines.

Approval of D1 does not authorize production implementation. D2 and D3 remain required.

## 14. Information still required from NILES

Before D2 can be accepted, the following NILES facts must be confirmed from the actual platform and repository:

- current OpenAPI coverage and accuracy;
- authentication flows and token model;
- role, permission, ownership, and tenant-policy representation;
- Incident state-machine representation;
- SLA engine, calendars, scheduler, and persistence model;
- metadata source of truth and export mechanism;
- audit, domain-event, notification, and background-job observability;
- test-environment provisioning, data seeding, reset, and isolation;
- current UI framework and accessibility semantics;
- CI/CD environments and release promotion flow;
- privacy and security constraints for traces and evidence.

No architecture document should present assumptions about these items as confirmed facts.
