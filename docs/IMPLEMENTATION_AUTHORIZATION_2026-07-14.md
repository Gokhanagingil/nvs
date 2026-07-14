# NVS M1 Implementation Authorization

> **Status:** Accepted and binding  
> **Decision date:** 2026-07-14  
> **Authority:** Product Owner — Gökhan Ağıngil  
> **Applies to:** NVS Milestone 1 and all implementation work derived from it

## 1. Context

The product-discovery package in PR #1 has been reviewed and merged. The Product Owner agrees with the core research conclusions:

- NVS must not rebuild a browser engine or other mature execution infrastructure;
- NVS should compose proven runners and concentrate its custom value in NILES-aware process semantics, generation, deterministic oracles, coverage, and evidence;
- Incident, SLA, authorization, tenant isolation, and realistic business outcomes form the first vertical slice;
- the immediate purpose is internal NILES release assurance rather than independent commercialization.

The business need is now urgent. NILES is appearing in front of customers, comprehensive manual UAT capacity is limited, and release quality directly affects product reputation. Discovery must therefore transition into controlled implementation.

## 2. Gate decision

The Product Owner records the following decision:

- **D1 — Problem and differentiation validated:** Complete.
- **D2 — Architecture and testability direction accepted:** Complete as an implementation baseline. Actual NILES contracts and any required testability seams must still be verified against the NILES repository and an approved environment; unsupported assumptions are not accepted as facts.
- **D3 — MVP contract accepted:** Complete with the amendments in this document.
- **D4 — Implementation authorized:** Complete.
- **D5 — MVP validated against NILES:** Open.

This document supersedes any earlier wording that limits the repository to documentation-only discovery or prohibits all production implementation.

## 3. Immediate business outcome

M1 is intended to create a practical digital validation capability that materially reduces reliance on a permanent two-to-three-person manual ITSM UAT team.

NVS should automate repeatable work that otherwise consumes experienced testers:

- scenario expansion and negative-path generation;
- role, ownership, property, and tenant variants;
- execution through API and selected UI paths;
- SLA lifecycle checks;
- side-effect and evidence collection;
- regression comparison and failure classification;
- repeatable release-candidate validation.

This does not mean that all human assurance disappears. Human effort should move from repeatedly executing scripts to reviewing business invariants, challenging scenario coverage, and assessing exceptional or ambiguous findings. Before first production authorization, an independent ITSM-informed review of the scenario pack remains desirable.

## 4. Product-positioning decision

NVS is **NILES-first and internally valuable first**.

- It is not initially positioned as a separately sold commercial product.
- It must deliver release-assurance value for NILES as quickly as responsible engineering permits.
- Its core remains adapter-based so that a later non-NILES target can be supported without rewriting orchestration, scenario, evidence, and UI foundations.
- Generic multi-product abstraction must not delay M1.

## 5. UI amendment

A usable web interface is required in the first working slice.

This decision modifies the earlier CLI/file-only recommendation:

- CLI and machine-readable artifacts remain required for CI/CD and automation.
- A thin web operations console is also required from the start.
- The first UI covers environments, scenario library, run center, evidence explorer, and semantic coverage.
- A drag-and-drop test designer, commercial tenant administration, billing, marketplace, distributed scheduler, and polished analytics product remain out of scope.
- Storage may initially remain filesystem-backed behind repository interfaces; a database is not required merely to justify the UI.

This amendment supersedes the CLI-only portion of DEC-017 and the blanket interpretation of DEC-028 that would prevent a thin operational UI. DEC-028 continues to reject building a broad commercial console and analytics platform before the validation core is proven.

## 6. Scenario-language amendment

Author-facing tests must be realistic business scenarios rather than lists of low-level commands.

The scenario model must separate three layers:

1. **Business scenario blueprint** — narrative, objective, actors, preconditions, business steps, risks, expected outcomes, evidence, variations, and cleanup policy.
2. **Executable domain plan** — deterministic semantic actions and assertions generated from the approved blueprint.
3. **Runner operations** — concrete HTTP, Playwright, metadata, and evidence-reader mechanics implemented by adapters.

An internal primitive such as `incident.resolve` is permitted in the compiled execution plan. It is not sufficient as the primary author-facing scenario description.

## 7. AI boundary

AI should reduce manual authoring and increase coverage, but it is not the release oracle.

AI may:

- propose and critique business scenarios;
- derive candidate steps from NILES contracts, metadata, documentation, and existing tests;
- generate risk-based variants;
- explain failures and suggest likely root causes;
- draft reviewed updates to scenarios and mappings.

Deterministic code, approved invariants, target responses, observable postconditions, and versioned evidence decide `PASS`, `FAIL`, or `BLOCKED`. AI must not silently change expected behavior or heal a release-gating test.

## 8. First vertical slice

The first complete business story is a customer-facing payment/API service degradation:

- a requester reports an outage or severe degradation;
- Service Desk classifies, assigns, and takes ownership;
- the affected service, offering, and/or CI is linked where the current NILES contract permits;
- response and resolution SLA behavior is observed;
- the incident is placed on hold while an external party is awaited;
- the incident resumes when work can continue;
- restoration and resolution evidence is recorded;
- the incident is resolved and then closed by the correct authority.

The slice includes successful behavior and negative variants for missing evidence, invalid transitions, insufficient roles, unauthenticated access, cross-tenant access, and unauthorized side effects.

## 9. Delivery policy

Implementation will proceed through small, reviewable PRs:

1. **M1-01 — Walking skeleton:** repository scaffold, verified NILES contract discovery, versioned business scenario schema, thin UI, environment probe, compile-only run, evidence manifest, tests, and CI.
2. **M1-02 — Incident API journey:** authenticated NILES adapter, deterministic fixture namespace, executable Incident lifecycle, state assertions, and correlated evidence.
3. **M1-03 — SLA and authorization variants:** SLA attach/pause/resume/stop assertions, role and tenant negatives, and side-effect-free denial evidence.
4. **M1-04 — Critical UI verification:** selected Playwright journeys and API/UI outcome consistency.
5. **M1-05 — Release-candidate run:** execute against the approved NILES release candidate and record product defects, test defects, environment blockers, and NILES-side testability gaps.

Each PR must build, test, document its assumptions, and stop at its declared boundary. A later PR may be resequenced when evidence justifies it, but scope expansion is not implicit.

## 10. Current authority

Production implementation for **M1-01** is explicitly authorized. Later M1 slices are authorized in principle but require the preceding slice to establish the contracts they depend on and must still be delivered as separate reviewable PRs.
