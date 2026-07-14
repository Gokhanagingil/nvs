# NILES Testability Contract for NVS

> **Status:** Proposed for joint NILES/NVS review  
> **Date:** 2026-07-14  
> **Decision gate:** D2  
> **Purpose:** Define the minimum safe capabilities NILES must expose so an external NVS can produce deterministic and trustworthy results

## 1. Principle

An external validation system cannot reliably test a workflow-heavy platform using UI clicks and public API responses alone.

NILES may contain:

- hidden state transitions;
- background jobs;
- event-driven side effects;
- SLA calculations and calendars;
- audit requirements;
- metadata-driven field and action rules;
- ownership and tenant filtering;
- asynchronous notifications or integrations.

NVS therefore needs a **testability contract**: stable, versioned interfaces for declarations, controlled non-production setup, synchronization, and observation.

The contract must improve observability and determinism without creating a bypass around the real product behavior being tested.

## 2. Non-negotiable boundaries

1. NVS invokes real NILES actions through real API or UI paths.
2. A test-only operation may prepare or observe a test environment, but it must not directly simulate the success of the business action under test.
3. Authorization tests use real actor credentials and real authorization enforcement.
4. UI tests interact with the real rendered interface.
5. Test controls that can alter time, data, or job execution are disabled in production and scoped to isolated test tenants or runs.
6. NVS is blocked rather than allowed to guess when model, environment, or evidence compatibility is uncertain.
7. No universal impersonation credential or unbounded test administrator is accepted as the normal execution model.

## 3. Capability classes

### Class P — Public product interfaces

These are normal NILES interfaces used by actual clients:

- application UI;
- supported public APIs;
- normal authentication flows;
- supported exports and integration interfaces.

NVS uses Class P for the business behavior under test.

### Class R — Read-only testability and observability

These interfaces disclose versioned declarations or correlated evidence without changing product state:

- environment/build fingerprint;
- metadata and process snapshots;
- role/policy declarations;
- SLA definition snapshot;
- audit/event/job/SLA observations;
- semantic UI manifest if required.

Class R may exist in production only after security review, least-privilege access control, and data-minimization analysis. The MVP should assume non-production availability.

### Class C — Controlled non-production operations

These operations change test-environment conditions:

- deterministic fixture creation;
- fixture cleanup or isolated namespace reset;
- virtual time advance;
- asynchronous job drain/trigger where safe;
- short-lived test identity issuance;
- dependency stub/fault controls if later approved.

Class C must be unavailable in production, auditable, narrowly scoped, and protected by both network and application authorization.

## 4. Contract discovery and versioning

NVS needs one discovery document or equivalent endpoint that reports supported capabilities.

Illustrative response:

```json
{
  "contractVersion": "niles-testability/v1alpha1",
  "environment": "uat-03",
  "environmentClass": "non-production",
  "nilesBuild": "...",
  "apiFingerprint": "sha256:...",
  "metadataFingerprint": "sha256:...",
  "processFingerprint": "sha256:...",
  "policyFingerprint": "sha256:...",
  "slaFingerprint": "sha256:...",
  "capabilities": {
    "metadataSnapshot": true,
    "processSnapshot": true,
    "authorizationSnapshot": true,
    "slaSnapshot": true,
    "fixtureNamespace": true,
    "virtualClock": true,
    "jobAwait": true,
    "correlatedAudit": true,
    "correlatedEvents": true,
    "correlatedSlaLedger": true,
    "semanticUiContract": true
  }
}
```

Exact routes and field names are intentionally not prescribed during discovery. The logical contract is the requirement.

Rules:

- every contract response includes its schema version;
- snapshots are immutable for a given fingerprint;
- semantic breaking changes increment a compatibility version;
- NVS validates compatibility before any destructive or release-gating run;
- missing required capability produces `BLOCKED`, not `PASS`;
- snapshot generation time and source provenance are recorded.

## 5. Environment and build fingerprint

NVS must be able to prove which system it tested.

Minimum fields:

- environment stable identifier;
- environment class: local, development, test, UAT, staging, production;
- NILES application build/version/commit identifiers where available;
- deployed service/component versions;
- database schema or migration level;
- feature-flag fingerprint relevant to the test;
- OpenAPI fingerprint;
- metadata fingerprint;
- process/state-model fingerprint;
- role/policy fingerprint;
- SLA/calendar fingerprint;
- timezone and locale defaults;
- tenant/domain configuration fingerprint;
- testability-contract version;
- clock mode: real or virtual;
- relevant external dependency/stub identifiers.

NVS must refuse Class C operations when environment class is production.

Defense in depth should include:

- application-level production denial;
- separate credentials;
- network policy;
- explicit NVS environment allowlist;
- destructive-operation confirmation policy in CI configuration;
- audit of all Class C requests.

## 6. OpenAPI contract

NILES should expose a versioned OpenAPI document covering the supported APIs NVS tests.

Requirements:

- operation IDs are stable and unique;
- request and response schemas are complete enough for generation;
- authentication requirements are declared;
- error responses are documented;
- field formats, enums, nullability, bounds, and required properties are declared;
- deprecated operations are marked;
- API version and build fingerprint are correlatable;
- undocumented internal/debug routes are not accidentally exposed to NVS;
- sensitive examples or real customer data are excluded.

OpenAPI is not expected to express complete ownership, tenant, process, or object-level authorization semantics. Those belong in the policy and behavior snapshots.

## 7. Metadata snapshot

The metadata snapshot is a core NVS dependency.

For selected entities, it should expose stable semantic identifiers and declarations for:

- entity/table name and version;
- fields and types;
- required, nullable, default, unique, and read-only behavior;
- enum/choice values and lifecycle status;
- references and relationship cardinality;
- calculated or derived fields;
- sensitivity/redaction classification;
- create/read/update visibility rules where metadata-driven;
- actions and their semantic identifiers;
- list/export availability where relevant;
- validation rules that can be safely declared;
- source provenance.

The snapshot must distinguish:

- an absent rule;
- an unknown or unsupported rule;
- a rule implemented outside the metadata system.

NVS must not infer “allowed” or “no validation” from “unknown.”

## 8. Process and state snapshot

For Incident MVP scope, NVS needs:

- process identifier and version;
- states and terminal states;
- actions/transitions;
- source and target states;
- actor/role constraints where declared;
- guard identifiers and machine-readable conditions where safe;
- required input fields per transition;
- expected synchronous state effects;
- expected asynchronous effect identifiers;
- invalid/forbidden transition behavior;
- cancellation, reopen, or rollback paths where configured;
- state and transition semantic identifiers.

When a guard cannot be serialized, the snapshot should expose:

- stable guard identifier;
- human-readable description;
- required test fixture categories;
- observable decision result;
- source version.

NVS may then use curated invariants or concrete fixture templates rather than inventing the guard logic.

## 9. Authorization, ownership, and tenant snapshot

NVS needs expected decisions for generated role matrices.

The snapshot should represent, at an appropriate abstraction level:

- roles and role inheritance;
- groups or scopes relevant to decisions;
- actions/functions;
- resource/entity scope;
- object ownership or assignment scope;
- object-property read/write scope;
- tenant/domain scope;
- state-dependent permissions;
- explicit deny precedence where applicable;
- policy version and source;
- conditions that cannot be externally represented.

A conceptual rule:

```text
role.resolver may incident.resolve
when incident.assignment_group in actor.groups
and incident.tenant == actor.tenant
and incident.state in [in_progress]
```

NVS does not require the production policy engine implementation to be duplicated. It requires a versioned expected-decision model sufficient to generate and review tests.

Unknown policy cells are reported as coverage gaps. They are not assumed to allow or deny.

## 10. SLA definition and ledger contract

### 10.1 Definition snapshot

For each selected SLA definition:

- stable identifier and version;
- target entity/process;
- start condition;
- pause condition;
- resume condition if distinct;
- stop/completion condition;
- cancellation condition;
- target duration;
- warning thresholds if configured;
- calendar/schedule identifier and version;
- timezone behavior;
- priority or applicability rules;
- expected event/ledger types;
- retroactive/recalculation behavior if supported;
- known unsupported or externally implemented conditions.

### 10.2 Correlated SLA ledger

NVS needs a read-only, actor-authorized way to retrieve test-relevant SLA evidence by incident and run/correlation ID.

Evidence should include:

- definition/version;
- instance identifier;
- lifecycle status;
- start/pause/resume/stop/breach timestamps according to the SLA clock;
- accumulated elapsed and remaining business time;
- calendar/timezone used;
- triggering action/event references;
- recalculation entries;
- final outcome;
- source event/audit references.

The ledger is evidence. It is not automatically the oracle if the same defect could corrupt both action logic and ledger production. NVS should cross-check selected outcomes against state, event timing, and approved model expectations.

## 11. Virtual clock contract

### 11.1 Goal

Enable deterministic testing of time-dependent behavior without waiting for real time.

### 11.2 Required properties

- enabled only in approved non-production environments;
- scoped by isolated tenant, namespace, or run;
- cannot affect unrelated tests;
- explicit start instant;
- monotonic advance by duration or to a target instant;
- current virtual instant query;
- timezone/calendar interpretation remains the same as production logic;
- every clock operation is audited with actor and run ID;
- clock state is included in evidence;
- cleanup/reset is deterministic;
- advancing time triggers or allows deterministic processing of due work.

### 11.3 Forbidden design

A test endpoint must not directly set an SLA record to “breached” or “completed.” It must change the clock or scheduler condition so the real SLA engine produces that result.

### 11.4 Fallback

If scoped virtual time is impossible, the NILES team and NVS must jointly evaluate:

- a lower-level SLA engine harness for exhaustive logic;
- a small real-time end-to-end suite for integration confirmation;
- explicit limitations in release evidence.

This fallback weakens the external end-to-end guarantee and requires an ADR.

## 12. Fixture and cleanup contract

### 12.1 Requirements

NVS must create repeatable data without depending on unknown pre-existing records.

The contract should support:

- isolated fixture namespace or tenant;
- deterministic template identifiers;
- idempotent setup where practical;
- explicit generated record inventory;
- relationship and reference setup;
- actor ownership/assignment setup;
- correlation/run ID on created artifacts;
- bounded cleanup;
- cleanup verification;
- retention override for failed-run diagnosis under policy;
- no production use.

### 12.2 Preferred model

Fixtures should use supported public APIs when those APIs can create the required state without making the test circular.

A Class C fixture operation is justified when:

- the state is a prerequisite, not the behavior under test;
- public creation would be prohibitively slow or impossible;
- the operation is isolated and clearly recorded;
- post-setup validation confirms the intended prerequisite;
- it cannot create a false positive for the business action being tested.

### 12.3 Cleanup outcomes

- `CLEAN` — all owned data removed or isolated environment destroyed;
- `RETAINED_BY_POLICY` — failed-run evidence intentionally retained with expiry;
- `PARTIAL` — some data remains; run cannot be a clean pass;
- `UNKNOWN` — cleanup evidence insufficient; run is blocked.

## 13. Identity and credential contract

### 13.1 Actor requirements

The MVP needs distinct identities for:

- unauthenticated/no session;
- requester A;
- requester B with equivalent role for horizontal tests;
- resolver/service desk actor;
- administrator or privileged actor;
- different-tenant actor if multi-tenancy applies;
- optionally expired/disabled actor for lifecycle checks.

### 13.2 Credential principles

- real authentication and authorization paths;
- short-lived credentials or tokens;
- least privilege;
- tenant and role scope explicit;
- no credential values written to run artifacts;
- revocation after run;
- concurrent run isolation;
- actor mapping recorded by non-secret identifier;
- credential issuance and use audited.

### 13.3 Impersonation

A broad “impersonate anyone” test endpoint is discouraged.

If NILES has a legitimate impersonation feature that itself must be tested, that is a separate scenario. Normal NVS role testing should authenticate as distinct test identities or use a tightly scoped non-production identity broker whose output is equivalent to real actor tokens and cannot exceed declared roles.

## 14. Correlation contract

Every NVS action should carry or receive a correlation identifier that NILES propagates through supported layers.

Correlation targets:

- API request log;
- business action;
- audit entry;
- domain event;
- background job;
- notification;
- SLA ledger;
- integration call where allowed;
- UI network activity.

Requirements:

- collision-resistant run and step IDs;
- no sensitive data encoded in IDs;
- propagation documented;
- searchable within bounded retention;
- missing propagation reported as an evidence gap;
- user-visible records are not polluted with test identifiers unless the field is explicitly intended for correlation.

## 15. Asynchronous job synchronization contract

NVS must wait on domain completion, not arbitrary elapsed time.

The contract may provide one or more of:

- query by correlation ID for pending/completed jobs;
- event stream or webhook for completion;
- bounded await operation;
- test-tenant job drain;
- deterministic trigger of due jobs after virtual time advance.

Required result states:

- completed successfully;
- completed with domain failure;
- pending;
- dead-lettered/retried;
- unknown/not observable.

NVS records the wait condition and timeout. “Unknown” cannot become a pass.

## 16. Audit, event, notification, and state observations

For selected test resources, NVS needs safe read-only evidence.

### Persisted state

- entity and record identifier;
- selected non-sensitive field values;
- state and version/etag where available;
- ownership, assignment, and tenant fields relevant to assertions;
- timestamps and actor references;
- deletion/tombstone evidence where relevant.

### Audit

- action/change identifier;
- actor;
- timestamp;
- before/after for approved fields;
- source channel;
- correlation identifier;
- policy decision reference where available.

### Domain events

- event type and version;
- aggregate/resource identifier;
- timestamp;
- producer;
- correlation/causation identifiers;
- redacted payload or selected assertion fields;
- processing status where relevant.

### Notifications/integrations

- intended notification/integration type;
- recipient class or safe test destination;
- template/version;
- queued/sent/failed status;
- correlation identifier;
- no real customer destination in test environments.

Evidence endpoints must enforce authorization and data minimization. NVS should retrieve only what the scenario needs.

## 17. Semantic UI contract

### 17.1 Accessibility first

Critical controls and fields should expose:

- correct accessible role;
- stable accessible name or associated label;
- visible and enabled/disabled state;
- semantic relationships;
- predictable focus and modal behavior.

This improves both accessibility and test resilience.

### 17.2 Explicit test identifier

When accessible semantics are insufficient or localized text makes identity ambiguous, use a stable attribute such as:

```html
<button data-nvs="action.incident.resolve">Resolve</button>
<input data-nvs="field.incident.short_description" />
```

Rules:

- value derives from a stable metadata semantic key;
- it identifies intent, not layout;
- it does not contain database IDs, secrets, or tenant data;
- it remains stable across styling and layout refactors;
- a semantic change requires a versioned change;
- uniqueness is validated in the relevant UI scope.

### 17.3 Optional read-only UI manifest

A manifest may declare which semantic actions and fields are expected on a route for a role and metadata version.

It may not:

- invoke an action instead of the browser;
- reveal an action to an unauthorized actor if doing so creates information exposure;
- override actual UI visibility;
- become a privileged bypass.

NVS still opens the real page, locates the real component, and performs the real interaction.

### 17.4 List and export surfaces

When list column configuration and spreadsheet export enter NVS scope, the UI/API contract should expose stable semantic column identifiers, selected-view configuration, export request identity, and safe evidence of exported schema/row authorization. These are outside the Incident/SLA MVP unless required for an authorization risk.

## 18. Error contract

Testability operations should return structured errors with:

- stable error code;
- human-readable message;
- capability and contract version;
- correlation identifier;
- retryability;
- safe diagnostic details;
- no stack trace, secret, or sensitive record content unless explicitly protected and approved.

Suggested categories:

- incompatible contract version;
- environment not allowed;
- capability unsupported;
- actor unauthorized;
- tenant/run scope violation;
- fixture conflict;
- clock operation invalid;
- asynchronous work timeout;
- observation unavailable;
- evidence redacted;
- cleanup incomplete.

## 19. Security requirements

### 19.1 Environment isolation

- dedicated test/UAT environments or isolated tenants;
- production Class C controls physically and logically disabled;
- NVS allowlist and environment fingerprint check;
- separate service identities per environment;
- test destinations for email/webhook integrations.

### 19.2 Authorization

- separate scopes for snapshot read, evidence read, fixture control, clock control, and job control;
- least privilege;
- deny by default;
- explicit tenant/run scoping;
- no privilege inferred from network location alone.

### 19.3 Secrets

- external secret provider or CI secret mechanism;
- short-lived tokens where supported;
- never in Git, scenario YAML, logs, traces, screenshots, or reports;
- automatic redaction plus validation tests for redaction;
- revocation and rotation procedures.

### 19.4 Evidence data

- field-level sensitivity classification from metadata;
- redaction before persistence;
- encryption in transit and at rest;
- access logging;
- retention and deletion policy;
- separate approval before evidence leaves the controlled environment or is sent to an AI provider.

### 19.5 Abuse prevention

- rate limits and execution quotas;
- maximum virtual-time advance per operation/run;
- maximum fixture volume;
- audit and alerting for unusual control use;
- kill switch;
- no arbitrary code execution through metadata or scenario input;
- schema validation and allowlisted semantic actions.

## 20. Reliability requirements

The contract should support:

- idempotent read operations;
- deterministic Class C operations or explicit idempotency keys;
- bounded timeouts;
- retries only for declared transient failures;
- concurrency isolation;
- cleanup after runner crash;
- observable partial failure;
- backward-compatible version negotiation;
- health/capability checks separate from business test results.

The testability interface being unavailable is an environment or contract failure, not a product pass.

## 21. NILES implementation guidance

The contract should be implemented as a coherent NILES testability capability, not a collection of hidden debug endpoints.

Preferred qualities:

- documented and versioned;
- owned by a named NILES component/team;
- security-reviewed;
- covered by NILES unit/integration tests;
- deployed through normal release mechanisms;
- included in environment fingerprinting;
- disabled or reduced by environment policy;
- observable and audited;
- backward compatibility defined.

NVS should maintain connector compatibility tests against the contract.

## 22. Contract acceptance checklist for D2

D2 cannot be accepted until the actual NILES architecture confirms or revises each item.

### Required for the architecture spike

- [ ] Environment/build fingerprint
- [ ] Versioned OpenAPI retrieval
- [ ] Incident metadata snapshot
- [ ] Incident state/action snapshot
- [ ] Selected role/ownership/tenant policy snapshot
- [ ] Selected SLA definition snapshot
- [ ] Distinct test actor authentication
- [ ] Isolated deterministic fixture setup
- [ ] Correlation propagation
- [ ] Persisted state observation
- [ ] Audit or equivalent change evidence
- [ ] SLA ledger/evidence
- [ ] Asynchronous completion observation
- [ ] Virtual time or approved deterministic fallback
- [ ] Stable semantic UI identifiers for one Incident journey
- [ ] Cleanup and cleanup verification
- [ ] Production safety denial
- [ ] Secret and evidence redaction validation

### Required before release-gating MVP use

- [ ] Contract version compatibility policy
- [ ] Concurrent-run isolation
- [ ] Retention and deletion policy
- [ ] Test control audit trail
- [ ] Defined ownership and support path
- [ ] Failure and timeout semantics
- [ ] Evidence completeness checks
- [ ] Security review
- [ ] Threat model
- [ ] Recovery from interrupted run
- [ ] Demonstrated repeatability

## 23. Known design tension

The more NILES exposes for testing, the easier NVS becomes—but the larger the security and maintenance surface.

The target is not maximum introspection. It is the **minimum sufficient contract** that enables deterministic validation of approved invariants.

Every interface should answer:

1. Is this declaration, setup control, synchronization primitive, or observation necessary?
2. Can the same result be achieved safely through a supported product interface?
3. Could this interface bypass the behavior being tested?
4. Could it be abused in production?
5. Is its output authoritative enough to serve as evidence?
6. Can its semantics be versioned and maintained?

## 24. D2 recommendation

Approve this document as a requirements baseline, then reconcile it against the actual NILES codebase and architecture.

Do not accept D2 until virtual time, asynchronous synchronization, role/policy representation, metadata authority, and evidence correlation are demonstrated—not merely planned.
