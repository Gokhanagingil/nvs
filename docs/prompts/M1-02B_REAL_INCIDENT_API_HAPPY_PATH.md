# Cursor/Codex Prompt — M1-02B Real Incident API Happy Path

Use this prompt after the M1-02B kickoff documentation PR is merged.

**Primary repository:** `Gokhanagingil/nvs` — writable  
**Reference repository:** `Gokhanagingil/grc` — strictly read-only  
**Governing issue:** `Gokhanagingil/nvs#9`  
**Parent milestone:** `Gokhanagingil/nvs#2`  
**Execution:** one coherent implementation agent; do not split the initial architecture pass across parallel agents

---

## Prompt to give the implementation agent

You are implementing **M1-02B — Real Incident API Happy Path** for NVS.

M1-01 established a deterministic business blueprint, compiler, compile-only runs, evidence bundles, and a thin operations console. M1-02A added immutable packaging, staging deployment, environment readiness, private NILES connectivity, synthetic actor profiles, a secret-provider boundary, and independent real NILES authentication sessions.

M1-02B is the first slice allowed to mutate approved non-production NILES data. It executes the positive `journey=normal` path of the Payment API Service Degradation scenario through the real NILES Incident API, applies deterministic assertions after every step, persists sanitized correlated evidence, and accounts for every created resource. It does not implement negative authorization/tenant variants or browser automation.

Work autonomously through inspection, implementation, validation, focused commits, push, and creation of a draft pull request. Do not wait for approval on ordinary reversible engineering choices. Never hide a NILES capability gap or turn uncertainty into PASS. Do not invoke a live staging mutation from the coding workstation or CI; live acceptance is an explicit post-deployment operator action after reviewed fixture configuration.

## 1. Repository boundaries

The workspace contains two independent repositories:

- `nvs` — writable primary implementation repository.
- `grc` — strictly read-only NILES reference repository.

All files, dependency changes, branches, commits, pushes, workflows, tests, Docker changes, and pull requests belong only to `nvs`.

Do not create, modify, delete, rename, format, generate files, install dependencies, switch branches, stash, reset, stage, commit, or push anything in `grc`.

Use `grc` only for read operations such as search, file inspection, `git log`, `git show`, `git rev-parse`, and `git status`.

Never use NVS implementation code to weaken NILES authorization, bypass tenant guards, impersonate a user, write directly to the NILES database, or invoke undocumented internal administration paths.

## 2. Start-up procedure

Before editing:

1. Verify both repositories are clean.
2. In `nvs` only:
   - fetch `origin`;
   - switch to `main`;
   - pull with `--ff-only`;
   - confirm the expected starting commit is at least `fa82624322d032cd928582e419705baf15c21d53` or a later reviewed `main`;
   - create and switch to:

```text
agent/m1-02b-real-incident-api
```

3. Read completely:
   - `AGENTS.md`;
   - `PROJECT_CHARTER.md`;
   - `docs/IMPLEMENTATION_AUTHORIZATION_2026-07-14.md`;
   - `docs/DECISIONS.md`;
   - `docs/roadmap/M1_PRODUCT_DELIVERY_PLAN_2026-07-14.md`;
   - `docs/adr/ADR-0001-M1-WALKING-SKELETON-STACK.md`;
   - `docs/adr/ADR-0002-DEPLOYMENT-AND-ACTOR-SESSION-FOUNDATION.md`;
   - `docs/discovery/NILES_CONTRACT_FINDINGS_M1.md`;
   - `docs/prompts/M1-02A_DEPLOYABLE_FOUNDATION.md`;
   - this prompt;
   - GitHub issues #2 and #9;
   - merged PRs #7 and #8, including their final review discussion when accessible.

4. Inspect the current NVS contracts, compiler, core orchestration, NILES adapter, secret provider, filesystem storage, Fastify API, React console, deployment assets, and all M1-01/M1-02A tests before changing architecture.

5. Inspect the current default branch of `grc`. At minimum inspect:
   - authentication/JWT/tenant/correlation behavior;
   - `backend-nest/src/itsm/incident/incident.controller.ts`;
   - `backend-nest/src/itsm/incident/incident.service.ts`;
   - Incident entity, enums, DTOs, transition-policy enforcement, tests, and permission mapping;
   - `backend-nest/src/itsm/sla/sla.controller.ts` and public SLA summary DTOs;
   - `backend-nest/src/itsm/journal/journal.controller.ts` and public journal DTOs;
   - public read APIs for groups, services, offerings, and CIs required by fixture readiness;
   - current audit/event read surfaces, if any;
   - existing NILES acceptance/integration tests that exercise the same lifecycle.

6. Record the inspected GRC SHA in M1-02B documentation and the PR description. The previously inspected baseline was `33af470e10fa753b79e092d9a99ef4f570854b10`; do not assume it is still current.

7. First return a concise implementation plan, then proceed without waiting for approval.

## 3. Accepted baseline

Treat the following operator acceptance as established M1-02B input, not something to reimplement:

- NVS is deployed as an immutable exact-SHA image on the approved staging host.
- NVS local configuration and persistent-storage readiness are `ready`.
- NVS reaches the NILES backend through the approved private Docker network.
- The staging environment is enabled and non-production.
- Five dedicated synthetic actors are configured outside Git.
- Authentication preflight returns PASS for all five actors with independent sessions and correct tenant contexts.
- The current server-owned `.env`, actor profiles, mappings, environment definition, and Docker-network configuration remain authoritative runtime inputs.

Do not commit real actor emails, passwords, tokens, tenant-specific secrets, or populated server configuration.

## 4. Business outcome

At the end of this PR, NVS must be able to:

- report whether an approved environment is ready for real Incident execution without performing a write;
- start one explicitly confirmed `LIVE_API` run for the approved `payment-api-service-degradation` scenario and `journey=normal` variation;
- authenticate required actors once and maintain isolated run-scoped sessions;
- execute the safely supported real Incident lifecycle through NILES;
- assert selected business state after every step;
- collect correlated, sanitized Incident/SLA/journal evidence;
- persist a durable run namespace and resource inventory so a crash cannot silently orphan a created record;
- finish with deterministic PASS, FAIL, or BLOCKED semantics;
- verify cleanup where supported or record a controlled retained-resource outcome where platform policy prevents deletion;
- surface the result and resource disposition in the existing Run Center and Evidence Explorer.

No result may claim a complete happy-path PASS when the close authority, required fixture, required evidence, or resource disposition is unresolved.

## 5. Binding product and safety decisions

### 5.1 Positive API path only

Execute only:

```text
scenario = payment-api-service-degradation
variation = journey=normal
runType = LIVE_API
```

Other executable scenario/variation requests are BLOCKED in this slice.

The following remain compile-only or deferred:

- missing-resolution-evidence;
- close-before-resolve;
- insufficient-role;
- unauthenticated;
- cross-tenant;
- hold-resume-SLA variation as an independent release claim;
- priority-SLA-matching variation as an independent release claim.

M1-03 owns authorization, tenant-isolation, and negative side-effect proofs. M1-04 owns browser execution and API/UI parity.

### 5.2 Dual mutation gate

A real write is allowed only when both a versioned non-secret environment policy and a server-owned runtime switch allow it.

Use a documented design such as:

```text
environment.execution.liveApiEnabled = true
NVS_ENABLE_NILES_MUTATIONS=true
```

Exact naming may differ if consistently documented and tested.

Requirements:

- defaults are disabled;
- production rejects execution before secret resolution, login, fixture reads, or mutation;
- a disabled environment rejects execution before login or mutation;
- a missing runtime switch rejects execution before login or mutation;
- the API requires an explicit mutation confirmation field, not merely `runType`;
- the UI clearly states that a real NILES Incident will be created;
- ordinary readiness, health, probes, page loads, CI, and deployment verification never cause mutations;
- do not log the runtime switch or environment variables wholesale.

### 5.3 Fixture readiness before the first write

The runner must not create an Incident until all required non-secret fixture references are validated through bounded read-only calls.

At minimum validate:

- environment and primary tenant binding;
- actor mapping and actor authentication readiness;
- assignment group UUID or explicitly accepted canonical assignment label;
- payment service UUID;
- service-offering UUID when configured;
- CI UUID and relationship type when configured;
- allowed impact and urgency;
- hold reason/detail that satisfy current NILES policy;
- resolution notes template that satisfies current NILES policy;
- declared close strategy;
- declared cleanup/retention strategy.

Fixture readiness returns safe states and typed reasons. It never returns credentials, bearer material, raw headers, or unrestricted upstream payloads.

Do not auto-create users, tenants, groups, services, offerings, CIs, calendars, SLA policies, or other shared fixtures in M1-02B.

### 5.4 Requester report versus operational writer

Current GRC source indicates that role `user` can read Incidents but does not receive `ITSM_INCIDENT_WRITE`, while direct Incident creation requires that permission.

Until a dedicated requester-safe Incident intake contract is confirmed, model this truth explicitly:

- the semantic requester remains the source of the business report;
- the Service Desk actor is the operational API writer that records the Incident on the requester's behalf;
- when supported, set `requesterId` to the authenticated requester UUID;
- evidence must show both the semantic reporting actor and the operational writing actor;
- this is not proof that a requester can create an Incident directly;
- do not use an admin actor merely to simplify the path.

If current GRC inspection reveals an approved requester intake endpoint that creates an Incident under requester authority, document and use it instead. Do not guess such an endpoint.

### 5.5 Close authority is contract-driven

The approved blueprint currently names an Incident Manager for close, but inspected GRC source implements close as requester/opening-user confirmation. Align the versioned business blueprint with current product truth; do not preserve an obsolete actor merely for test convenience.

Update the blueprint with a version bump and clear provenance so that:

- the Incident Manager reviews resolution/journal evidence;
- the requester performs requester-confirmation close when the actual permission contract allows it;
- no actor is described as requester authority unless the NILES record and authenticated identity prove that fact.

Before the first mutation, determine whether the configured close strategy is satisfiable by the current actor and permission contract.

If requester confirmation cannot be executed safely:

- do not impersonate;
- do not rewrite `requesterId` to another actor;
- do not omit close and return PASS;
- do not use tenant admin or Service Desk and label it requester confirmation;
- execute only the preceding steps permitted by the reviewed execution policy;
- return BLOCKED with a stable code such as `NILES_CLOSE_AUTHORITY_UNSATISFIABLE`;
- attempt verified cleanup while the record is still in a deletable state when that is safe and allowed;
- retain the record only when cleanup cannot be verified or the profile explicitly requires diagnostic retention;
- record the required NILES-side capability change as a separate dependency.

Never modify `grc` in this branch. A NILES change requires a separate explicitly approved issue, branch, and PR.

### 5.6 Cleanup and retention are first-class outcomes

Current GRC source rejects deletion of a closed Incident. Therefore full close and verified delete may be mutually exclusive.

Support explicit profile policies such as:

```text
cleanupPolicy:
  onPass: RETAIN_CLOSED
  onFail: RETAIN_FOR_DIAGNOSIS
  onBlockedBeforeClose: DELETE_IF_RUN_OWNED
```

Exact naming may differ.

Requirements:

- never claim deletion when a closed record was retained;
- a retained closed Incident may still accompany PASS only when retention was pre-approved by the execution profile and every required lifecycle/assertion succeeded;
- persist the retained Incident UUID, number, final state, reason, and run association;
- cleanup may target only resources proven to belong to the current run;
- verify soft deletion with a follow-up read/list observation;
- cleanup uncertainty is BLOCKED, not PASS;
- do not use reopen solely to make a closed Incident deletable;
- do not use direct database deletion, broad search deletion, or NILES container/database access.

### 5.7 SLA scope is observation, not an unsupported claim

Read the current SLA record endpoints before, during, and after hold/resume/resolve where available.

Do not assume that Incident transitions automatically attach, pause, resume, or complete an SLA unless the actual response proves it.

The fixture profile must declare each SLA evidence requirement as required or observational. If required evidence is unavailable, return BLOCKED. If observational evidence is absent, record `NOT_OBSERVED` without converting it into PASS for SLA behavior.

No virtual time, breach acceleration, calendar mutation, SLA definition write, or attribution recompute is allowed in this slice.

### 5.8 Production and environment boundary

- `kind: production` execution is forbidden before secrets or network access.
- Do not expose a production mutation control in the UI.
- Keep the NVS control plane loopback-only unless protected by the separately approved proxy/tunnel model.
- Do not publish the NILES backend port or bypass Cloudflare by weakening public security controls.

## 6. Confirmed NILES contract to re-verify

At GRC baseline `33af470e10fa753b79e092d9a99ef4f570854b10`:

```text
POST   /grc/itsm/incidents
GET    /grc/itsm/incidents/:id
PATCH  /grc/itsm/incidents/:id
POST   /grc/itsm/incidents/:id/assign
POST   /grc/itsm/incidents/:id/take-ownership
POST   /grc/itsm/incidents/:id/start-work
POST   /grc/itsm/incidents/:id/hold
POST   /grc/itsm/incidents/:id/resume
POST   /grc/itsm/incidents/:id/resolve
POST   /grc/itsm/incidents/:id/close
DELETE /grc/itsm/incidents/:id
POST   /grc/itsm/incidents/:id/affected-cis
GET    /grc/itsm/incidents/:id/affected-cis
```

SLA/journal reads include:

```text
GET /grc/itsm/sla/records/:recordType/:recordId
GET /grc/itsm/sla/records/:recordType/:recordId/summary
GET /grc/itsm/sla/records/:recordType/:recordId/assignment-segments
GET /grc/itsm/:table/:recordId/journal
GET /grc/itsm/:table/:recordId/journal/count
```

Every authenticated tenant request requires:

```text
Authorization: Bearer <actor token>
x-tenant-id: <approved tenant UUID>
x-correlation-id: <generated safe correlation ID>
```

Never persist or expose the Authorization value.

Current policy facts to re-verify:

- states are `open`, `in_progress`, `on_hold`, `resolved`, `closed`;
- impact and urgency are `low`, `medium`, `high`;
- high impact plus high urgency normally maps to `p1` unless a tenant priority matrix overrides it;
- ownership/assignment is required before `in_progress`;
- hold detail minimum is 12 characters;
- resolution notes minimum is 20 characters;
- resume returns an on-hold Incident to `open` or `in_progress`;
- close requires `resolved`;
- close actor must match requester/opening-user authority;
- closed Incidents cannot be soft-deleted through the public delete route.

Handle both direct and globally wrapped successful API responses where current NILES behavior requires it. Reject malformed or ambiguous response shapes with typed errors.

## 7. Versioned execution and fixture contracts

Add the smallest set of runtime-validated contracts needed for safe execution. Suggested contract families are:

```text
nvs.niles-incident-fixture/v1
nvs.execution-readiness/v1
nvs.resource-inventory/v1
nvs.step-observation/v1
nvs.run/v2
```

Exact naming may differ if documented and migration-safe.

The fixture contract should contain only non-secret configuration and provenance. Real environment-specific fixture files must be server-owned and ignored by Git; committed files are sanitized examples.

The run contract must preserve compatibility with existing `nvs.run/v1` compile-only bundles or provide an explicit validated migration/union. Do not silently reinterpret prior evidence.

## 8. Run namespace and durable in-flight safety

Every live run requires:

- collision-resistant immutable `runId`;
- deterministic short marker such as `NVS-M1-02B:<runId>` in allowed Incident text/metadata;
- scenario ID/version and environment association;
- a durable run-intent checkpoint written before the first NILES mutation;
- a resource inventory checkpoint written immediately after a create response and before later lifecycle calls;
- final immutable run/evidence bundle publication only after outcome and cleanup/retention are known.

A process crash must not make a created Incident undiscoverable.

Implement a small single-node coordinator. A safe design may use:

- one active live run per environment/tenant;
- in-memory execution state for low-latency progress;
- durable sanitized checkpoint files under the configured NVS data directory;
- polling endpoints for active progress;
- startup detection of unfinished checkpoints;
- stale runs surfaced as `BLOCKED` / `INTERRUPTED_WITH_RESOURCE_INVENTORY` rather than automatically resumed.

Do not expose an unfinished run as PASS. Do not overwrite a prior run ID.

## 9. Run-scoped actor-session cache

Evolve the preflight session design into a run-scoped cache without weakening secrecy.

Requirements:

- authenticate each required profile independently;
- resolve credentials only through the secret-provider port;
- destroy each credential immediately after login;
- reuse each actor's isolated session across that actor's steps;
- never share a token between actor IDs;
- require session tenant to match the expected tenant before mutation;
- destroy every session in `finally`, including failures and cancellation;
- session objects remain non-serializable with bearer material redacted from `toJSON`;
- public progress/evidence uses actor profile IDs/personas, never login identifiers.

A live run must not reuse sessions left by an earlier preflight or run.

## 10. NILES Incident adapter boundary

Extend `@nvs/adapter-niles` or add one narrowly scoped NILES package. Do not place transport calls directly in Fastify routes, React code, or the business compiler.

Define typed operations for at least:

- fixture read/validation;
- create Incident;
- get Incident;
- assign;
- take ownership;
- start work;
- add/read affected CI link where configured;
- hold;
- resume;
- resolve;
- close;
- read SLA record summary/instances;
- read journal/count;
- soft-delete run-owned Incident;
- verify cleanup.

Each operation must:

- accept an `ActorSession`, expected tenant, correlation ID, and typed input;
- construct bounded URLs only from the validated environment base URL and known paths;
- set `x-tenant-id` and `x-correlation-id`;
- use timeouts and abort signals;
- validate HTTP status and response shape;
- return a normalized domain observation, not an unrestricted upstream payload;
- classify 400/401/403/404/409/422/429/5xx/network/timeout/malformed responses safely;
- redact transport diagnostics;
- never log request headers or raw bodies containing confidential material.

## 11. Semantic action mapping

Compile the approved business blueprint and permit only explicit mappings.

A reviewed initial mapping is:

| Business step | Operational actor | NILES operation / assertion |
|---|---|---|
| requester report | requester as semantic source; Service Desk as writer unless a requester-safe intake API is confirmed | create Incident with deterministic marker and requester identity when supported |
| triage impact | Service Desk | assert impact/urgency and observed priority; do not assume tenant matrix |
| assign Service Desk | Service Desk | assign approved group and/or user |
| take ownership | Service Desk | take ownership; assert `assignedTo` |
| start work | Service Desk | start work; assert `in_progress` and available first-response evidence |
| link service context | Service Desk | create fields and/or affected-CI relation using validated fixture IDs |
| observe active SLA | Service Desk | normalized read-only SLA observation |
| hold for provider | Service Desk | hold with compliant reason/detail; assert `on_hold` |
| observe held SLA | Service Desk | normalized observation only unless profile marks required |
| resume restoration | Service Desk | resume to `in_progress`; assert hold fields cleared/normalized |
| resolve with evidence | Service Desk | resolve with compliant notes; assert `resolved`, timestamp, and requester-confirmation posture |
| inspect resolution audit | Incident Manager | read Incident/journal/SLA evidence; no mutation required |
| close resolved Incident | requester when actual authority and permission are proven | requester-confirmation close; otherwise typed BLOCKED |

Do not execute unknown semantic actions. Do not use generic reflection or arbitrary method/path execution from scenario files.

## 12. Deterministic assertions

After every mutation, perform a separate read where safe so assertions are not based only on the mutation response.

At minimum assert selected normalized fields:

### Create/read

- valid Incident UUID and number;
- deterministic run marker;
- expected tenant context where returned safely;
- expected requester relationship when configured;
- `open` state;
- configured impact and urgency;
- observed priority recorded and compared with the expected fixture rule;
- no unrelated shared record is adopted into the inventory.

### Assignment and ownership

- assignment group/user values match the fixture;
- Service Desk ownership is visible;
- available action metadata is recorded where present.

### Start work

- `in_progress` state;
- ownership remains intact;
- first-response timestamp or equivalent observation is captured when surfaced.

### Service/CI context

- service/offering IDs match validated fixtures where set;
- affected-CI relation exists when required by the profile;
- relationship absence is BLOCKED when declared required, otherwise `NOT_OBSERVED`.

### Hold

- `on_hold` state;
- pending reason/detail match normalized expected values;
- journal/action observation is captured when available.

### Resume

- state returns to the configured `open` or `in_progress` value;
- pending fields are cleared or normalized according to confirmed NILES behavior.

### Resolve

- `resolved` state;
- resolution notes satisfy and reflect the approved restoration evidence template;
- resolved timestamp is present where surfaced;
- requester-confirmation metadata is recorded where safely surfaced;
- SLA/journal observations are normalized without unsupported claims.

### Close

- execute only when authority/permission preflight proves the configured actor can perform it;
- assert `closed` state, close mode, closing actor, and timestamp where surfaced;
- if close is unsupported, return BLOCKED rather than fabricating an assertion.

Use exact deterministic values, allowed sets, or typed predicates. Do not compare giant upstream snapshots or include volatile/confidential fields in evidence.

## 13. Verdict and error taxonomy

Preserve deterministic top-level verdicts:

- `PASS` — every required in-scope step/assertion succeeded and disposition matches the pre-approved cleanup/retention policy;
- `FAIL` — observed NILES product behavior contradicted a frozen deterministic expectation;
- `BLOCKED` — execution could not safely establish an expectation or prerequisite.

Add stable typed categories/codes for at least:

- mutation disabled;
- production forbidden;
- unsupported scenario/variation;
- fixture missing/invalid/not found/incompatible;
- actor missing/authentication/tenant mismatch;
- live-run concurrency conflict;
- transport timeout/network/rate limit;
- login or action denied;
- malformed upstream response;
- NILES validation/policy rejection;
- state assertion failure;
- SLA/journal evidence unavailable;
- close authority unsatisfiable;
- cleanup failed/unverifiable;
- interrupted run with resource inventory.

Never classify a deterministic NILES assertion mismatch as an environment blocker merely to avoid FAIL. Never classify a missing fixture as product FAIL.

## 14. Evidence model and sanitization

Persist a final atomic immutable bundle containing:

- run record and compiled plan;
- exact scenario version and variation;
- target environment and observed NILES build/version where available;
- GRC contract SHA used for implementation documentation;
- safe fixture profile ID/version, not secret values;
- run namespace;
- resource inventory;
- per-step observation files;
- final evidence manifest with persisted-byte hashes;
- sanitization declaration;
- cleanup/retention result.

A step observation may contain:

- step ID and semantic action;
- semantic actor and operational actor profile IDs;
- correlation ID;
- method and normalized path template;
- status code;
- started/completed timestamps and duration;
- sanitized request intent;
- selected normalized before/after fields;
- assertion results;
- typed error when applicable;
- references to SLA/journal observations.

It must never contain:

- email/login identifier;
- password;
- access/refresh token;
- cookie;
- Authorization header;
- MFA material;
- unrestricted request/response headers;
- raw upstream payloads;
- server filesystem paths;
- confidential configuration values.

Extend recursive secret scanning to every new contract, checkpoint, log shape, API response, UI state, test artifact, and final bundle. Preserve exact persisted-byte hash verification and atomic visibility guarantees from M1-01.

## 15. API design

Evolve existing routes consistently. A valid design may include:

```text
GET  /api/environments/:id/execution-readiness
POST /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/progress
GET  /api/runs/:id/inventory
GET  /api/runs/:id/evidence
```

For live execution, `POST /api/runs` should require a validated payload such as:

```json
{
  "runType": "LIVE_API",
  "environmentId": "staging-example",
  "scenarioId": "payment-api-service-degradation",
  "variationValues": { "journey": "normal" },
  "confirmRealMutation": true
}
```

Do not accept arbitrary fixture values, URLs, headers, paths, tokens, or actor identities from the browser payload. Resolve all authoritative configuration from validated server-side repositories.

Return `202 Accepted` for an asynchronously coordinated live run if progress polling is implemented. Preserve compile-only API behavior and compatibility.

## 16. Web console

Extend the existing Run Center and Evidence Explorer.

Required behavior:

- show environment kind/enabled state and mutation readiness;
- show fixture readiness with safe typed reasons;
- allow only the approved scenario and normal variation for live execution;
- distinguish Compile only from Create real NILES Incident;
- require an explicit confirmation interaction;
- show that the control creates or may retain a real non-production Incident;
- disable live execution for production, disabled environments, missing fixtures, missing actors, or disabled runtime mutation gate;
- show queued/running/completed step states;
- show semantic and operational actors without login identifiers;
- show final verdict, failed assertion/blocker, Incident number/UUID when safe, and cleanup/retention state;
- link to persisted evidence views;
- maintain accessible labels, keyboard behavior, loading/error/empty states, and stable semantic selectors.

Do not redesign the application or introduce a general workflow editor.

## 17. Storage and crash recovery

Extend the filesystem repository behind existing interfaces rather than bypassing it.

Requirements:

- durable run intent before first write;
- durable resource inventory as soon as the Incident identity is known;
- atomic final bundle publication;
- no partial final PASS record;
- duplicate run IDs rejected without overwrite;
- startup scans identify incomplete live runs;
- incomplete runs remain visible as recovery-required BLOCKED records or checkpoints;
- recovery guidance can search only by the deterministic run marker and inventory;
- do not auto-resume lifecycle mutations after restart;
- all files stay under `NVS_DATA_DIR` with the existing runtime UID/GID model.

Add failure-injection tests around every persistence boundary that could otherwise orphan a NILES resource.

## 18. CI and test matrix

Preserve `corepack pnpm run ci` as the primary application quality command.

CI must use deterministic mocks/fakes only and must never require live NILES credentials.

Add tests for at least:

1. fixture schema and sanitized example validation;
2. readiness success and each missing/incompatible fixture blocker;
3. production/mutation-disabled/unsupported-variation rejection before auth/network;
4. isolated actor sessions and guaranteed destruction;
5. exact request path/header/body construction without bearer leakage;
6. direct and wrapped NILES responses;
7. full mocked create/read/assign/ownership/start/CI/hold/resume/resolve/close path;
8. requester-report versus Service Desk writer evidence;
9. close-authority-unsatisfiable BLOCKED path;
10. required versus observational SLA behavior;
11. journal normalization;
12. state assertion mismatch as FAIL;
13. NILES policy rejection classification;
14. rate limit/timeout/network/malformed-response classification;
15. resource inventory written before subsequent lifecycle actions;
16. cleanup success, closed-record retention, cleanup failure, and verification failure;
17. process/interruption checkpoint recovery;
18. atomic final bundle and no partial PASS visibility;
19. recursive secret scanning over checkpoints and evidence;
20. API route semantics and UI operator journey;
21. existing compile-only, preflight, deployment, rollback, hardening, and Chromium tests.

Use a fake NILES server or typed fetch mock that models state transitions; do not make tests a sequence of unrelated canned responses that cannot detect incorrect ordering or tenant/actor use.

## 19. Deployment and operations impact

Update operator documentation for:

- new config directories/files and numeric ownership/modes;
- sanitized fixture template installation;
- server-only mutation switch;
- execution-readiness validation before deployment cutover;
- control-plane exposure warning;
- live-run concurrency;
- retained-record inventory and cleanup review;
- interrupted-run recovery;
- safe credential rotation without evidence changes;
- exact post-deployment acceptance sequence.

Deployment must continue to preserve server-owned `.env`, config, and data. Do not place fixture IDs or mutation enablement in the image.

Add a post-deployment acceptance runbook that first proves readiness and authentication, then obtains explicit operator confirmation before one real run. Do not embed actual tenant, actor, service, group, offering, or CI UUIDs in committed documentation.

## 20. Explicit non-goals

Do not implement:

- authorization or insufficient-role negative execution;
- unauthenticated execution;
- cross-tenant attack execution;
- denied-action side-effect proof;
- browser/NILES UI automation;
- API/UI parity;
- reopen;
- SLA breach acceleration or virtual time;
- SLA policy writes or attribution recompute;
- automatic shared fixture creation;
- production execution;
- database-backed NVS storage;
- distributed queue/workers;
- scheduling/nightly suites;
- AI scenario generation;
- release gates;
- managed secret-manager integration;
- public control-plane exposure;
- GRC repository changes.

## 21. Recommended implementation order

1. Re-verify NILES contracts and write a concise M1-02B contract note/ADR amendment.
2. Freeze fixture, readiness, inventory, step-observation, and live-run contracts.
3. Add mutation policy enforcement and fixture repository/readiness service.
4. Add run-scoped actor-session cache.
5. Add typed NILES Incident/SLA/journal adapter methods and transport tests.
6. Update/version the business blueprint to current close authority truth.
7. Add deterministic normal-path executor and state oracles.
8. Add durable run intent, inventory checkpointing, final bundle, and recovery detection.
9. Add API coordinator/routes.
10. Extend Run Center and Evidence Explorer.
11. Add cleanup/retention policy and failure-injection tests.
12. Update deployment/operations docs and sanitized examples.
13. Run the complete validation matrix and inspect the final diff for secrets and scope creep.

Do not begin with UI mocks that have no executable domain path. Do not begin by calling live staging.

## 22. Required validation before push

At minimum run and report:

```text
corepack pnpm run ci
```

Also run the repository's focused contract, adapter, core, API, storage-failure, browser, shell, Compose, container-build, hardening, and secret-scan checks affected by the change.

Build and start the production image locally with fake/sanitized configuration. Verify:

- liveness/readiness/version;
- compile-only behavior;
- authentication preflight behavior;
- execution readiness;
- production and disabled mutation gates;
- mocked live-run API/UI path;
- no live NILES call.

Inspect the full diff and generated artifacts for credentials, bearer values, real fixture UUIDs, local paths, and accidental GRC changes.

## 23. Commit and pull-request discipline

Use focused commits that make review and rollback understandable. A reasonable sequence is:

1. contracts and execution policy;
2. fixture readiness and adapter;
3. executor/session/inventory/evidence;
4. API/UI;
5. operations/docs/hardening.

Do not force this sequence if a safer dependency order emerges, but avoid one opaque giant commit.

Push only the NVS branch and open a draft PR against `main`.

The PR description must include:

- business outcome;
- exact implemented lifecycle;
- actor semantics and requester/operational-writer distinction;
- confirmed GRC SHA and contracts;
- close-authority result and any separate NILES dependency;
- mutation gates;
- fixture model;
- evidence and cleanup/retention semantics;
- crash-recovery behavior;
- CI/test evidence;
- explicit statement that no live staging mutation was run by CI or the implementation agent;
- exact operator steps still required for post-deployment live acceptance;
- confirmation that `grc` remained clean and unchanged.

Reference issues #9 and #2.

## 24. Completion report

At the end, report:

- branch and commits;
- draft PR;
- files/architecture added;
- supported live action sequence;
- safety gates;
- fixture readiness states;
- evidence and resource disposition model;
- test results;
- known limitations;
- whether current NILES close authority is satisfiable;
- any separately required GRC issue/decision;
- exact reviewed post-merge deployment and live-acceptance steps.

Do not claim M1-02B live PASS until an approved deployed build executes the real staging path and its persisted evidence/resource disposition have been reviewed.