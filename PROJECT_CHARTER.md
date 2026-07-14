# NVS Project Charter

> **Status:** Approved for product discovery  
> **Effective date:** 2026-07-14  
> **Current phase:** Documentation-first; no production implementation

## 1. Mission

NVS (NILES Validation Suite) is intended to become an independent, evidence-producing validation system for NILES.

Its purpose is to verify that NILES behaves as intended across:

- APIs and integrations;
- critical user journeys;
- process and state transitions;
- SLA lifecycle and timing behavior;
- metadata integrity;
- roles, permissions, object ownership, and tenant boundaries.

NVS must answer more than “did the screen work?” It must answer “did the platform produce the correct business outcome, for the correct actor, under the correct rules, with sufficient evidence to trust a release?”

## 2. Problem statement

NILES is a metadata-driven enterprise platform with interconnected workflows and side effects. Happy-path tests alone are not sufficient, while manually authoring and maintaining every test scenario will not scale.

Generic API and UI automation tools can execute actions, but they do not inherently understand NILES concepts such as incidents, SLA clocks, assignments, state models, role boundaries, CMDB relationships, or metadata consistency.

The working hypothesis is that an external validation orchestrator can:

1. derive a large deterministic baseline from OpenAPI contracts and NILES metadata;
2. generate process paths and role variants from state and policy models;
3. capture selected real user journeys and lift them into semantic, maintainable scenarios;
4. execute those scenarios through established test engines rather than rebuilding those engines;
5. produce reproducible release evidence and coverage measured in NILES business terms.

This hypothesis must be tested during discovery. It is not treated as proven.

## 3. Current decision

We are proceeding with **product discovery and architecture research**, not production implementation.

NVS will initially be evaluated as an internal quality and release-assurance capability for NILES. Commercial productization is a future option, not a current assumption.

No production code will be written until the discovery gates in this charter are satisfied.

## 4. Discovery scope

The current phase will produce and review:

- a market and precedent study;
- a build/buy/compose assessment;
- a clear differentiation thesis;
- architecture options and a recommended direction;
- the required NILES testability contract;
- an Incident + SLA + authorization MVP definition;
- explicit non-goals, risks, decision gates, and measurable acceptance criteria;
- an initial decision log and Architecture Decision Records (ADRs).

## 5. Current non-goals

During discovery and the first MVP, NVS is not intended to:

- become a generic replacement for Playwright, API testing tools, contract-testing tools, or load-testing tools;
- cover every NILES module;
- create a broad visual test designer or connector marketplace;
- use an LLM as the authoritative test oracle;
- silently “heal” a test in a way that can hide a product regression;
- provide full performance, penetration, accessibility, or visual-regression testing;
- certify customer production environments without an explicitly approved security and operating model.

## 6. Product and engineering principles

1. **External and independent by default**  
   NVS validates NILES from outside the product boundary. Purpose-built observability and testability interfaces are allowed, but they must not bypass the real authorization or business behavior being tested.

2. **Deterministic core; AI-assisted edges**  
   Release decisions must be based on deterministic assertions and versioned evidence. AI may propose, classify, explain, or draft; it may not become the sole source of truth.

3. **Semantic intent over screen coordinates**  
   A scenario expresses “assign the incident” or “resolve the incident,” not “click the third button in the upper-right corner.” UI adapters resolve that intent through accessibility semantics and stable testing contracts.

4. **Generate the baseline; curate the meaning**  
   Contract, metadata, role-matrix, boundary, and state-path variants should be generated where possible. Human attention is reserved for business invariants, risk decisions, and exceptional workflows.

5. **API-first, critical UI, cross-layer assertions**  
   Business rules and authorization are validated at the API boundary first. A smaller set of critical UI journeys proves that users can actually perform—and are prevented from performing—the same actions.

6. **Negative paths are first-class**  
   Unauthorized actions, invalid transitions, missing metadata, race conditions, time boundaries, cross-tenant access, and partial failures are part of the design—not a later hardening exercise.

7. **Evidence over confidence**  
   Every run must preserve enough evidence to reproduce and diagnose a result: inputs, actor, environment fingerprint, metadata version, actions, responses, state transitions, relevant audit/events, and UI traces when applicable.

8. **Secure by default**  
   Least-privilege test identities, isolated test data, short-lived secrets, redaction, and explicit environment safeguards are mandatory.

9. **Version everything that can change meaning**  
   Scenario definitions, generators, adapters, metadata snapshots, role policies, expected outcomes, and release criteria are versioned.

10. **Compose before building infrastructure**  
    NVS should orchestrate proven execution engines unless a documented gap justifies custom infrastructure.

## 7. Roles and responsibilities

### Product Owner — Gökhan Ağıngil

- owns product intent, priorities, risk appetite, and final decisions;
- approves discovery gates, scope changes, and release criteria;
- accepts or rejects architecture recommendations.

### Architecture and Research Partner — ChatGPT

- performs research and synthesis;
- proposes product boundaries, architecture, risks, and decision criteria;
- documents uncertainty and competing alternatives honestly;
- must not present an assumption as a confirmed NILES fact.

### Implementation Agent — Codex or another approved engineering agent

- implements only approved scope;
- keeps changes small, reviewable, and tested;
- may challenge a decision and propose a better alternative;
- must not apply an unapproved architecture or scope change.

### Reviewers

- independently challenge correctness, security, maintainability, and evidence;
- distinguish product defects from test defects and environment defects.

AI tools are collaborators, not accountable owners. Final accountability remains with the Product Owner and designated human reviewers.

## 8. Working agreement

- Documentation precedes production code.
- Architectural choices that are difficult to reverse require an ADR.
- Changes are made through focused commits and reviewed pull requests.
- Research claims include primary or official sources wherever possible.
- An alternative may be proposed at any time; it is not implemented before approval when it changes scope or architecture.
- Generated code and documentation are reviewed under the same standard as human-authored work.
- Secrets, credentials, tokens, personal data, customer data, and production exports are never committed.
- Tests must fail loudly when their prerequisites, oracle, or evidence are uncertain; uncertainty is never converted into a pass.
- A flaky result is classified and addressed; it is not normalized as acceptable background noise.

## 9. Decision gates

### D0 — Charter accepted

**Status:** Complete.

### D1 — Problem and differentiation validated

Required outcomes:

- market precedents and alternatives are documented;
- the problem is shown not to be adequately solved by simply adopting one existing tool;
- a narrow, defensible NVS value proposition is agreed;
- a “do not build” conclusion remains an acceptable outcome.

### D2 — Architecture and testability contract accepted

Required outcomes:

- architecture option and key technology choices are recorded;
- trust boundaries and credential handling are defined;
- the minimum NILES-side testability contract is agreed;
- the design avoids duplicating mature execution engines without justification.

### D3 — MVP contract accepted

Required outcomes:

- Incident, SLA, and authorization scope is explicit;
- generated and curated scenario classes are defined;
- acceptance metrics and release-gate behavior are measurable;
- non-goals and deferments are approved.

### D4 — Implementation authorized

Production implementation may start only after D1–D3 are approved.

### D5 — MVP validated against NILES

The MVP must demonstrate repeatable execution, trustworthy failure evidence, meaningful semantic coverage, and at least one real defect or regression class that would be difficult to catch with happy-path testing alone.

## 10. Definition of discovery complete

Discovery is complete when:

- the market study, architecture recommendation, MVP definition, testability contract, and decision log are reviewed;
- unresolved assumptions are explicitly listed with an owner and validation method;
- the Product Owner has made a documented build, buy, compose, or stop decision;
- the next phase can be estimated and implemented without inventing the product boundary during coding.

## 11. Change control

This charter is a living document during discovery. Material changes to mission, trust boundaries, AI authority, MVP scope, or decision gates require explicit Product Owner approval and must be recorded in the decision log.
