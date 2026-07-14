# NVS MVP — Incident + SLA + Authorization

> **Status:** Proposed for D3 review  
> **Date:** 2026-07-14  
> **Implementation authorization:** Not granted; D1–D3 approval required

## 1. MVP objective

Prove that NVS can independently and repeatably determine whether the NILES Incident process, its SLA behavior, and its authorization boundaries conform to approved contracts and invariants.

The MVP is successful when it provides materially stronger release confidence than happy-path UAT, while requiring substantially less manual maintenance than a large hand-authored test suite.

The MVP is not measured by the number of test cases. It is measured by:

- semantic risk coverage;
- determinism;
- defect detection;
- evidence quality;
- maintainability after NILES changes;
- safe operation.

## 2. Product statement

> Given a versioned NILES test environment, NVS compiles the Incident metadata, process, SLA, and authorization model; generates bounded positive and negative scenarios; executes them through API and selected UI paths; observes correlated side effects; and returns a reproducible release verdict with explicit coverage gaps.

## 3. Why this scope

Incident + SLA + authorization is the smallest meaningful vertical slice because it exercises:

- API contract and entity metadata;
- field validation and defaults;
- state transitions and guards;
- multiple user roles;
- object ownership and assignment;
- potential tenant isolation;
- background jobs and eventual consistency;
- time-dependent behavior;
- audit/events and evidence;
- critical UI journeys.

A narrower “create an Incident through the API” demo would validate execution plumbing but not the NVS product hypothesis.

## 4. Explicit non-goals

The MVP does not include:

- Request, Change, Problem, CMDB, GRC, Audit, BCM, or Space modules;
- a generic reporting module;
- list-column customization or spreadsheet export testing unless required for an authorization risk;
- full performance/load testing;
- penetration testing or a full security scanner;
- visual-regression testing;
- broad accessibility certification;
- mobile or native application testing;
- distributed execution grid;
- web-based scenario designer;
- long-term analytics database;
- customer self-service portal;
- multi-product connector marketplace;
- autonomous AI release decisions;
- silent test self-healing;
- production-environment mutation.

## 5. MVP operating mode

- CLI-first;
- CI-friendly but CI-provider agnostic;
- one approved non-production NILES environment at first;
- isolated test tenant/namespace where applicable;
- file-based versioned inputs and run artifacts;
- no persistent NVS database;
- deterministic seed and run manifest;
- explicit human review of invariant and model changes.

## 6. In-scope actors

Exact NILES role names must be mapped from the real platform. The semantic actor classes are:

1. **Unauthenticated actor** — no valid session/token.
2. **Requester A** — creates and accesses permitted own resources.
3. **Requester B** — same role as A, used for horizontal access testing.
4. **Resolver / Service Desk actor** — performs approved assignment and lifecycle actions.
5. **Out-of-scope resolver** — similar privilege but outside the permitted assignment/group/resource scope, where the NILES policy supports this distinction.
6. **Administrator / privileged actor** — validates permitted administrative behavior without becoming the default execution identity.
7. **Different-tenant actor** — required if multi-tenancy/domain separation applies to the environment.
8. **Disabled/expired actor** — optional stretch case for credential/session lifecycle.

Credentials must be distinct, least-privilege, short-lived where possible, and absent from artifacts.

## 7. In-scope channels

### API

API is the primary channel for:

- business rule and state validation;
- positive and negative authorization;
- object/property-level access;
- generated payload variants;
- deterministic setup when the setup itself is not under test;
- post-condition queries.

### UI

UI is used for a smaller set of critical journeys to prove:

- the intended actor can discover and perform the action;
- mandatory/read-only/visible behavior matches metadata where in scope;
- prohibited actions are hidden or disabled appropriately;
- the UI invokes behavior consistent with the API;
- semantic locators survive layout change.

UI restrictions are not treated as the authorization boundary; corresponding API denial is required.

## 8. MVP capabilities

### M1 — Environment compatibility and safety gate

Before execution, NVS must:

- retrieve environment/build/testability fingerprints;
- verify non-production environment class;
- verify required contract versions and capabilities;
- confirm test namespace/tenant isolation;
- confirm credential availability without reading secret values into logs;
- block execution when compatibility or safety cannot be proven.

### M2 — OpenAPI ingestion and generated baseline

NVS must:

- retrieve and fingerprint the NILES OpenAPI document;
- discover Incident operations;
- generate schema/property cases through the selected runner;
- apply approved operation filters;
- supply actor authentication;
- normalize findings and reproducible requests;
- distinguish schema failure from domain-invariant failure.

### M3 — Incident behavior model compilation

NVS must compile a normalized Incident model including:

- fields and selected constraints;
- actions;
- states and transitions;
- guard identifiers and known prerequisites;
- role/ownership/tenant policy inputs;
- expected synchronous and asynchronous evidence;
- source fingerprints and diagnostics.

Unknown or conflicting declarations must appear as model gaps.

### M4 — Model-based process generation

NVS must generate bounded process paths that cover:

- all in-scope states;
- all declared allowed transitions at least once where reachable;
- selected shortest paths to important terminal states;
- at least one forbidden transition attempt from each in-scope non-terminal state where meaningful;
- selected reopen/cancel/close paths if present in the actual model;
- role variants required by transition guards.

The generator must use a deterministic seed and report unreachable states/transitions.

### M5 — Authorization matrix generation

For in-scope actions and selected fields, NVS must generate:

- unauthenticated attempts;
- approved positive access;
- same-role cross-user horizontal attempts;
- lower-privilege vertical attempts;
- out-of-scope group/assignment attempts where relevant;
- cross-tenant attempts where relevant;
- object-property read/write attempts for selected sensitive or restricted fields;
- direct API calls for actions absent in the UI;
- post-denial checks proving no unauthorized side effects.

### M6 — SLA model and virtual-time execution

NVS must support the configured lifecycle elements that exist in the selected NILES SLA definition:

- applicability/non-applicability;
- start;
- pause;
- resume;
- stop/completion;
- cancel if configured;
- warning threshold if configured;
- breach boundary;
- business calendar and timezone behavior;
- recalculation or definition change behavior only if it is part of the approved MVP configuration.

Execution must use scoped virtual time or an explicitly approved deterministic fallback.

### M7 — Semantic UI journeys

NVS must execute selected Playwright journeys using accessibility semantics and stable explicit identifiers.

The scenario definition stores semantic actions; Playwright selectors remain adapter details.

### M8 — Correlated evidence bundle

Every release-gating run must preserve:

- version/fingerprint manifest;
- scenario and generation provenance;
- actor/role/tenant mapping;
- fixture inventory;
- redacted API evidence;
- state before/after important actions;
- audit/event/job evidence where required;
- SLA ledger evidence;
- Playwright trace for UI failures and selected gate runs;
- assertions and classification;
- cleanup outcome;
- semantic coverage report;
- release-policy verdict.

### M9 — Failure classification and release policy

NVS must distinguish at least:

- product defect;
- contract drift;
- test defect;
- environment defect;
- flaky/non-deterministic result;
- security-policy block;
- unclassified.

`BLOCKED` and `UNCLASSIFIED` cannot be treated as passing release evidence.

## 9. Scenario strategy

The MVP should not begin with 30–50 manually scripted end-to-end scenarios.

It should begin with:

- a small curated set of high-value semantic scenario templates;
- generated field, state, role, ownership, tenant, and time variants;
- a small critical UI set;
- permanent regression scenarios created from confirmed defects.

A template may produce dozens of concrete cases while remaining one maintainable expression of business intent.

## 10. Curated semantic scenario templates

The exact state and action names below are placeholders until compiled from NILES.

### Incident templates

#### I1 — Create a minimal valid Incident

- permitted requester creates an Incident;
- required defaults and derived fields are correct;
- record is readable by the creator;
- initial state is correct;
- expected audit/event evidence exists;
- applicable SLA starts.

#### I2 — Reject missing or invalid required data

Generated variants omit or corrupt selected required, typed, enum, reference, length, and format fields.

Assertions include:

- expected rejection;
- stable error contract;
- no partial persisted record;
- no success audit/event/SLA side effect.

#### I3 — Authorized field update

- permitted actor updates an editable field;
- state/version and audit are correct;
- unrelated protected fields do not change.

#### I4 — Unauthorized or read-only field update

Generated role/property variants attempt restricted updates.

Assertions include response denial or field rejection and absence of unauthorized side effects.

#### I5 — Assignment or ownership change

- approved actor performs an allowed assignment action;
- assignment/group/ownership state is correct;
- audit/event evidence is correct;
- role scope is re-evaluated where expected.

#### I6 — Allowed process transition

Generated from each declared reachable transition.

Assertions include:

- correct target state;
- required fields and guards enforced;
- exact expected side effects;
- no unexpected terminal behavior.

#### I7 — Forbidden process transition

Attempt a non-declared or guard-failing transition.

Assertions include:

- deterministic denial;
- unchanged protected state;
- no success event, notification, or SLA effect;
- denial audit if required by policy.

#### I8 — Resolve before SLA breach

- approved resolver resolves the Incident;
- state and resolution fields are correct;
- SLA completes/stops according to the definition;
- completion occurs before breach;
- correlated evidence is complete.

#### I9 — Reopen or equivalent return path

Included only if the actual model supports it.

- permitted actor reopens/returns the Incident;
- process state and SLA behavior match the approved model;
- invalid actors are denied.

#### I10 — Concurrent or stale update

Included if NILES exposes version/etag/conflict semantics.

- two actors or sessions operate on the same record;
- stale update behavior is deterministic;
- no silent data loss occurs according to approved policy.

### SLA templates

#### S1 — Applicable SLA starts

Validate definition selection, start instant, target, calendar, and initial ledger state.

#### S2 — Non-applicable SLA does not start

Generate a fixture outside applicability conditions and verify no stray SLA instance or event.

#### S3 — Pause and resume

Advance virtual time before, during, and after a configured pause condition.

Validate:

- pause/resume status;
- elapsed and remaining business time;
- no time accrual during pause according to the model;
- event/ledger entries.

#### S4 — Breach boundary

Run deterministic variants:

- just before target;
- exactly at target according to NILES semantics;
- just after target.

Validate status, timestamp, event, and notification/integration evidence where configured.

#### S5 — Completion before breach

Resolve/complete before target and confirm no later breach side effect occurs after additional virtual-time advance.

#### S6 — Completion after breach

Allow breach, then resolve/complete. Validate final state and preservation of breach history according to the approved model.

#### S7 — Calendar/timezone boundary

Use a configured boundary such as schedule opening/closing, weekend, holiday, or timezone transition. Exact cases depend on the selected NILES calendar.

### Authorization templates

#### A1 — Unauthenticated access

Attempt selected Incident list/read/create/update/action operations without a valid session.

#### A2 — Horizontal object access

Requester B attempts to read or mutate Requester A's Incident where ownership policy should restrict it.

#### A3 — Vertical function access

Requester attempts resolver or administrative actions directly through the API.

#### A4 — Out-of-scope resolver

Resolver outside the permitted assignment/group scope attempts selected actions where NILES policy uses such scope.

#### A5 — Cross-tenant access

Different-tenant actor attempts list, direct-object, update, and action access.

#### A6 — Property-level access

Actors attempt to read or write selected restricted fields through direct and bulk/list paths.

#### A7 — UI/API consistency

For selected critical actions:

- allowed actor sees and can invoke the action;
- denied actor does not see or cannot enable it;
- denied actor is also rejected through direct API invocation.

## 11. Critical UI journey set

The first UI set should remain intentionally small. Candidate journeys, subject to actual NILES behavior:

1. requester creates an Incident and sees the resulting record;
2. resolver finds, opens, assigns, and advances an Incident through an allowed state;
3. resolver resolves an Incident and sees correct state/SLA outcome;
4. denied requester cannot discover or invoke a resolver-only action, and the direct API call is also denied;
5. same-role user cannot access another user's restricted Incident through list navigation or direct URL where policy requires isolation;
6. optional reopen/return journey if included in the actual state model.

The architecture spike may start with one journey; the release-gating MVP should include the approved critical set.

## 12. Generated case dimensions

Generators may combine dimensions only under bounded selection rules.

Potential dimensions:

- actor/role;
- tenant;
- resource owner;
- assignment/group scope;
- process state;
- action;
- field/property;
- valid/invalid input class;
- SLA applicability;
- virtual time boundary;
- calendar/timezone;
- API/UI channel;
- metadata version;
- feature flag where relevant.

Controls for state explosion:

- risk-weighted mandatory cells;
- pairwise or t-wise combinations for selected dimensions;
- shortest path to target state;
- deterministic random seed;
- per-generator execution budget;
- failure shrinking/minimization;
- changed-model prioritization;
- explicit excluded combinations with rationale.

## 13. Evidence requirements by scenario class

| Scenario class | Minimum evidence |
|---|---|
| API contract/property | operation, redacted request/response, schema finding, minimal reproducer, actor/environment fingerprint |
| Incident transition | before/after state, actor, action, guard/transition ID, audit/event evidence, response |
| Authorization denial | actor/role/tenant, resource/ownership, request/response, policy expectation, proof of no unauthorized state or side effect |
| SLA | virtual clock operations, definition/calendar fingerprint, ledger, triggering actions/events, state, boundary assertion |
| UI | semantic step, resolved locator strategy, screenshot/trace on failure, network correlation, resulting domain evidence |
| Cleanup | created-resource inventory, delete/reset actions, remaining-resource check, final cleanup classification |

## 14. Release-gate policy for MVP

A candidate NILES build is `PASS` only when:

- environment and model compatibility checks pass;
- all mandatory curated invariants pass;
- all required generated coverage cells execute successfully;
- no cross-tenant, horizontal, vertical, object-property, or function-level authorization violation is found in scope;
- SLA lifecycle and selected boundaries pass;
- all critical UI journeys pass;
- no `UNCLASSIFIED` or flaky result remains in the mandatory set;
- evidence completeness checks pass;
- cleanup is `CLEAN` or an explicitly approved failed-run retention policy applies;
- no unexpired release waiver is violated.

A candidate is `FAIL` when a deterministic product assertion fails.

A candidate is `BLOCKED` when environment, contract, evidence, credentials, cleanup, or nondeterminism prevents a trustworthy verdict.

## 15. MVP exit criteria

### Model and generation

- [ ] Incident fields, actions, states, and selected policies compile from versioned sources.
- [ ] All in-scope reachable states are covered.
- [ ] All in-scope declared allowed transitions are covered at least once.
- [ ] Selected forbidden transitions are generated per relevant source state.
- [ ] Unreachable, ambiguous, or unsupported elements are reported explicitly.
- [ ] Generated cases record source and deterministic seed.

### API

- [ ] Every discovered in-scope Incident operation has a generated conformance baseline or an approved exclusion.
- [ ] Selected invalid inputs produce no partial success side effects.
- [ ] Response contracts and domain post-conditions are both checked where applicable.

### Authorization

- [ ] Every approved in-scope actor/action/resource matrix cell is executed through the API.
- [ ] Horizontal and vertical cases are demonstrated.
- [ ] Object-property cases are demonstrated for selected restricted fields.
- [ ] Cross-tenant cases are demonstrated if multi-tenancy applies.
- [ ] Every denial includes proof of no unauthorized state-changing side effect.
- [ ] Selected UI visibility checks match API enforcement.

### SLA

- [ ] Selected SLA applicability and non-applicability are demonstrated.
- [ ] Start, pause, resume, completion/stop, and breach behavior are demonstrated where configured.
- [ ] Just-before/at/just-after boundary behavior is deterministic.
- [ ] Calendar/timezone evidence is recorded.
- [ ] Repeating the same virtual-time scenario three times from the same snapshot and seed produces the same domain result.

### UI

- [ ] Critical journeys use accessibility semantics or stable explicit identifiers.
- [ ] No release-gating scenario depends on screen coordinates.
- [ ] No unjustified deep CSS/XPath selector is used.
- [ ] A non-semantic layout change does not require a scenario rewrite.
- [ ] UI failures produce a usable Playwright trace and correlated domain evidence.

### Evidence and classification

- [ ] Every mandatory scenario emits a complete run manifest and evidence index.
- [ ] Secrets and selected sensitive fields are absent or redacted.
- [ ] An induced product defect is caught and classified.
- [ ] An induced test defect is distinguishable from the product defect.
- [ ] An induced environment failure is distinguishable from both.
- [ ] No mandatory result remains unclassified.
- [ ] Artifact hashes validate.

### Safety and repeatability

- [ ] Production Class C operations are denied by NILES and NVS controls.
- [ ] Test actors are least-privilege and isolated.
- [ ] Concurrent or sequential runs do not leak fixture data across run scope.
- [ ] Cleanup is verified.
- [ ] Three identical full mandatory runs from equivalent environment/model snapshots have no divergent verdict.

### Maintainability

- [ ] One Incident metadata change is ingested and produces an explainable model/scenario diff.
- [ ] One non-semantic UI refactor requires no scenario change and at most a justified adapter change.
- [ ] A confirmed defect can be promoted into a permanent semantic regression scenario.
- [ ] The team can identify which generated coverage changed and why.

## 16. Architecture spike versus MVP

### Architecture spike

Purpose: validate the riskiest interfaces with disposable code.

Minimum:

- one Incident model slice;
- one generated API family;
- one role matrix slice;
- one process path;
- one semantic UI journey;
- one virtual-time SLA path;
- one evidence bundle;
- induced failure classification.

The spike does not need polished packaging or full coverage.

### Release-gating MVP

Purpose: operate repeatedly against NILES candidate builds.

Requires:

- supported schemas and compatibility;
- complete approved in-scope coverage;
- security controls;
- repeatable fixtures and cleanup;
- stable evidence contract;
- CI use;
- documented ownership and failure handling.

Disposable spike code should be rewritten where needed rather than promoted by default.

## 17. Proposed work packages

No package is authorized before D4.

### WP0 — Decisions and actual NILES facts

- approve D1–D3;
- inspect NILES repository and architecture;
- resolve open questions;
- confirm selected environment and SLA definition.

### WP1 — Testability contract spike

- fingerprint;
- metadata/process/policy/SLA snapshot;
- fixture scope;
- correlation;
- observations;
- virtual time;
- cleanup;
- production denial.

### WP2 — Schemas and compiler

- behavior-model schema;
- scenario schema;
- evidence schema;
- compiler and diagnostics;
- snapshot compatibility.

### WP3 — CLI, orchestrator, and artifact layout

- safety gate;
- run manifest;
- deterministic seed;
- adapter interface;
- evidence index;
- exit codes.

### WP4 — API and OpenAPI generation

- semantic API adapter;
- Schemathesis spike/integration;
- redaction;
- domain post-conditions;
- minimal reproducers.

### WP5 — Process and authorization generation

- graph/path planner;
- allowed/forbidden transitions;
- role/ownership/tenant matrix;
- coverage report;
- failure shrinking.

### WP6 — SLA execution

- virtual clock adapter;
- ledger/evidence;
- boundary cases;
- deterministic asynchronous synchronization.

### WP7 — Playwright UI adapter

- semantic action mapping;
- critical journeys;
- trace correlation;
- UI/API authorization consistency.

### WP8 — Release policy and hardening

- failure taxonomy;
- mandatory gate policy;
- cleanup policy;
- CI example;
- security and threat-model review;
- repeatability and induced-failure tests.

## 18. Deferred roadmap

Only after MVP acceptance:

### Phase 2 — Wider ITSM

- Request;
- Change;
- CMDB relationships and data quality;
- broader role matrices;
- integration contracts.

### Phase 3 — Quality breadth

- performance/SLO adapter;
- accessibility adapter;
- security scanning adapter;
- notification/integration simulators;
- historical trend and flakiness analytics.

### Phase 4 — Assisted authoring and diagnosis

- requirement/diff-driven scenario proposals;
- reviewed recorder-to-semantic conversion;
- AI evidence summaries and classification suggestions;
- coverage-gap recommendations;
- never autonomous release authority.

### Phase 5 — Commercial exploration

- multi-environment/customer operating model;
- tenant-safe deployment;
- evidence attestations;
- packaging, licensing, support, and pricing;
- only after internal value and maintenance economics are demonstrated.

## 19. D3 recommendation

Approve the MVP as a vertical slice centered on:

- Incident behavior model;
- SLA deterministic time;
- API-first authorization matrix;
- selected semantic UI journeys;
- correlated evidence and release policy.

Do not approve an MVP defined as “write 30–50 end-to-end scripts.” The intended advantage comes from a smaller curated semantic core combined with generated variants and measurable model coverage.
