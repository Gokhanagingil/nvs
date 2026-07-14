# NVS — NILES Validation Suite

NVS is a proposed independent validation and release-assurance system for the NILES platform.

> **Project status:** Product discovery  
> **Implementation status:** No production code  
> **Initial scope:** Incident + SLA + authorization  
> **Primary use:** Internal NILES release qualification before any commercial-product decision

## Why NVS exists

NILES is a metadata-driven enterprise platform. A release can appear healthy at the UI level while a hidden workflow, SLA timer, authorization rule, state transition, audit record, or tenant boundary behaves incorrectly.

NVS is intended to validate the business outcome—not only the click path.

The central product hypothesis is:

> NVS can compile NILES contracts, metadata, process models, and access policies into deterministic tests; execute them through proven API and browser engines; and produce evidence that explains whether a NILES release is safe to promote.

This hypothesis is still under review. A decision not to build remains valid if discovery does not show a defensible gap.

## What NVS should be

- external to the NILES application boundary;
- aware of NILES process semantics;
- deterministic at the release-gate core;
- generated from contracts and models wherever possible;
- API-first, with selected critical UI journeys;
- strong on negative paths, roles, ownership, and tenant isolation;
- evidence-producing and reproducible;
- composed from mature execution engines rather than rebuilding them.

## What NVS should not be

- another generic browser automation framework;
- another API collection runner;
- a broad no-code test designer in its first phase;
- an LLM whose opinion determines pass or fail;
- a silent self-healing layer that can hide product regressions;
- a commercial product before it proves its value inside the NILES release process.

## Current research conclusion

The market already contains mature solutions for browser automation, API testing, model-based path generation, contract testing, AI-assisted test authoring, and platform-native test automation.

The potential NVS differentiation is therefore narrower:

1. compile NILES metadata and process definitions into an executable behavioral model;
2. validate Incident, SLA, role, ownership, and tenant invariants across API, UI, and observable side effects;
3. measure coverage in NILES terms—states, transitions, roles, policies, metadata rules, and SLA events;
4. produce a release evidence bundle that connects an action to its API result, state change, audit/event trail, SLA ledger, and UI trace;
5. remain externally operated so NILES does not certify itself.

## Documentation

- [Project Charter](PROJECT_CHARTER.md)
- [Product Discovery](docs/PRODUCT_DISCOVERY.md)
- [Market and Precedent Research](docs/MARKET_RESEARCH.md)
- [Architecture Options and Recommendation](docs/ARCHITECTURE.md)
- [NILES Testability Contract](docs/NILES_TESTABILITY_CONTRACT.md)
- [Incident + SLA + Authorization MVP](docs/MVP.md)
- [Decision Log](docs/DECISIONS.md)

Documents beyond the charter are introduced through the product-discovery pull request and may change after review.

## Decision gates

Production implementation is blocked until the Product Owner approves:

- **D1:** the problem and NVS differentiation;
- **D2:** the architecture and NILES testability contract;
- **D3:** the MVP scope and measurable exit criteria.

See [PROJECT_CHARTER.md](PROJECT_CHARTER.md) for the full governance model.

## Proposed technical direction

The working recommendation is a domain-aware orchestration layer, not a custom testing engine:

- a TypeScript control plane and CLI;
- Playwright for browser execution and UI/API traces;
- Schemathesis for OpenAPI-derived property tests;
- optional contract, performance, and security runners added behind adapters;
- versioned YAML/JSON scenario definitions and generated instances;
- file-based run artifacts first, with no database or web console in the MVP;
- a small, security-reviewed NILES testability contract for metadata snapshots, deterministic fixtures, virtual SLA time, asynchronous-job synchronization, and correlated evidence.

This direction is **proposed**, not yet accepted.

## Repository rules

- No secrets, tokens, customer data, production exports, or personal data.
- No production code before D1–D3 approval.
- Difficult-to-reverse choices require an ADR.
- AI-generated work receives normal engineering review.
- Tests may not convert uncertainty into a pass.
- Any automated test repair must produce a reviewed diff; silent healing is prohibited.

## Ownership

- **Product Owner:** Gökhan Ağıngil
- **Architecture and research partner:** ChatGPT
- **Implementation agent:** Codex or another approved engineering agent
- **Final accountability:** Human Product Owner and designated reviewers
