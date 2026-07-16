# Staging fixture bootstrap

The `staging fixture bootstrap` workflow creates the dedicated configuration records required by the M1-02B real Incident journey when the approved staging tenant is empty.

The workflow is deliberately separate from the NVS live Incident mutation switch. It configures tenant-owned staging fixtures through NILES public, permission-checked APIs while requiring `NVS_ENABLE_NILES_MUTATIONS` to remain disabled.

## Deterministic resources

The bootstrap owns only these exact natural keys:

- assignment group: `NVS Service Desk`
- CI class: `nvs_application`
- CMDB service: `NVS Payment API`
- service offering: `NVS Payment API Standard`
- configuration item: `NVS-PAYMENT-API-STG`
- governed Incident SLA policy: `NVS Payment API Incident SLA`
- dedicated, tenant-scoped NVS configuration approver account used only for governed four-eyes approval
- read-only compatibility checks for the Incident and Incident-CI choice contract

The Service Desk synthetic actor is added to the dedicated assignment group. The governed SLA policy is requested and published by the tenant-admin actor, while a distinct deterministic NVS configuration-approver tenant admin performs the required four-eyes approval. Its condition is limited to the deterministic Payment API service.

The configuration-approver credential is generated inside staging, never returned to the GitHub runner, and stored only as a mode-`0600` server-owned document under `/app/data/bootstrap`. It is not an ordinary Incident actor profile and is not exposed in application evidence or public workflow output.

The bootstrap does not create ITSM choice rows. It accepts the built-in `pending_external_dependency` reason, accepts `affected_by` and `service_impacting` only when the corresponding Incident-CI catalogs are truly unconfigured, reuses matching active catalog records when present, and blocks non-empty incompatible catalogs.

## Safety model

`plan` is read-only apart from ordinary actor authentication. It checks exact natural keys, compatibility, duplicate records, governed-SLA write posture, the current four-eyes policy state, and whether the server-owned configuration-approver credential is safely recoverable. It returns a SHA-256 digest derived from the private current-state plan without publishing live UUIDs or credentials.

`apply` requires all of the following:

```text
operation: apply
bootstrap_digest: <digest from the latest successful plan>
confirmation: BOOTSTRAP_M1_02B_FIXTURES
```

`apply` is intentionally manual and must never be started from an ordinary page render, scheduled workflow, deployment hook, or automatic retry.

Before either operation, the workflow verifies:

- the exact deployed NVS build SHA;
- the staging environment boundary;
- pinned SSH host trust;
- `NVS_ENABLE_NILES_MUTATIONS` is not enabled;
- no concurrent staging-control workflow is active.

Creation uses deterministic exact-name lookups and idempotency keys. Existing compatible records are reused. Duplicate or incompatible exact records block the operation. Choice compatibility is read-only and follows the pinned NILES product-default contract; retired legacy choice-write endpoints are never called. There is no broad search-and-delete behavior and no automatic rollback that might remove shared records. A partially completed apply is resumed by running a new plan and applying its new digest.

The private resource inventory and configuration-approver credential are stored inside the NVS data mount at:

```text
/app/data/bootstrap/staging-fixture-bootstrap.json
/app/data/bootstrap/<environment>-configuration-approver.json
```

Both documents are mode `0600`; the credential document is excluded from public summaries and artifacts.

The public GitHub summary and one-day artifact contain only action names, counts, dispositions, the plan digest, and sanitized error codes. They do not contain live UUIDs, credentials, bearer tokens, raw request/response payloads, or the private inventory.

## Browser operation

From the repository:

```text
Actions
→ staging fixture bootstrap
→ Run workflow
```

First run `plan` with the exact deployed SHA. Review the planned action list and digest. Only then run `apply` with the digest and exact confirmation phrase.

After a successful apply:

1. run `staging fixture / plan` with the existing selectors;
2. apply the generated NVS fixture proposal with `APPLY_M1_02B_FIXTURE`;
3. run confirmed read-only execution preflight;
4. run one guarded `staging live acceptance` journey;
5. verify evidence, cleanup/retention, and that the NVS Incident mutation switch is disabled again.

## Ownership boundary

This bootstrap is specific to the approved non-production tenant. It must not run against production and must not be generalized into an automatic seed of arbitrary customer tenants. Removing or changing the deterministic records requires a separately reviewed configuration change with explicit operator approval.
