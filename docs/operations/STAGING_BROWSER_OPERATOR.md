# Browser-only staging operator

The NVS control plane remains bound to the staging host loopback interface. These workflows provide a reviewed browser-triggered operator path for days when an approved workstation cannot open an SSH tunnel.

Use the `main` branch only:

- **Actions → staging operator → Run workflow** for non-mutating verification and discovery;
- **Actions → staging fixture → Run workflow** for guarded server-owned fixture planning and application;
- **Actions → staging live acceptance → Run workflow** for one explicitly confirmed M1-02B real Incident journey.

## Read-only staging operator

### `verify`

Runs only against the NVS loopback API on the staging host and reports:

- deployed build SHA;
- local readiness;
- loaded staging environment state;
- five synthetic credential configuration states;
- a real five-actor authentication preflight;
- static live-execution gates.

Set `expected_sha` to a reviewed 40-character commit when exact deployment identity must be enforced. The operation does not enable NILES mutation and does not create or change NILES business records.

### `discover`

Executes a short-lived Node process inside the existing NVS container. It reuses the server-owned tenant-admin credential in memory, authenticates through the configured private NILES URL, and reads only the approved tenant-scoped discovery surfaces:

- assignment-group directory;
- CMDB services;
- service offerings;
- compact CI search;
- Incident hold-reason choices;
- Incident-CI relationship and impact-scope choices.

Because this repository is public, the detailed candidate inventory is never printed to GitHub logs or the job summary. It is written atomically on the staging host as:

```text
/opt/nvs/releases/nvs-fixture-discovery-latest.json
```

The file is deploy-user owned, mode `0600`, and contains only selected non-secret IDs, names, lifecycle/status fields, and choice values. The GitHub summary reports counts and incomplete scopes only. Neither output contains the login identifier, password, bearer token, cookie, raw request/response body, or unrestricted upstream record.

The optional `query` filters groups, services, offerings, and configuration items. It is limited to 100 printable characters.

## Guarded staging fixture workflow

### `plan`

The plan operation performs fresh read-only discovery using four separate name selectors. It requires exactly one eligible result for each of:

- an active Service Desk assignment group;
- an active Payment CMDB service;
- an active offering linked to that selected service;
- an active Payment configuration item.

It also confirms that the tenant choice catalog contains `pending_external_dependency`, `affected_by`, and `service_impacting`. The selected UUIDs and labels remain in a mode-`0600` server file and are not printed publicly:

```text
/opt/nvs/releases/nvs-fixture-proposal-latest.json
```

A successful summary prints only the selector match counts, assignment binding mode, and a SHA-256 proposal digest. Refine a selector and rerun `plan` whenever a canonical selector matches multiple eligible records. If the tenant has no active assignment-group records, planning uses the frozen NILES legacy `assignmentGroup` label contract with the deterministic label `NVS Service Desk`; it does not create shared NILES group data.

### `apply`

Copy the exact proposal digest from the successful plan summary and enter the confirmation phrase:

```text
APPLY_M1_02B_FIXTURE
```

Application is refused unless:

- the proposal digest and 24-hour freshness window validate;
- the requested environment is non-production;
- the running image matches `expected_sha` when supplied;
- `NVS_ENABLE_NILES_MUTATIONS` is still absent or false.

The operation writes only the server-owned staging environment and Incident fixture files, validates the complete config against the currently running immutable image, and recreates only the `nvs` service with the same image. It creates distinct mode-`0600` outer rollback snapshots first. Any failure restores the original environment/fixture files and re-verifies the prior NVS deployment.

Applying a fixture does **not** enable NILES mutation and does not create or modify a NILES business record. The expected remaining live gate after a successful application is the server mutation switch.

## Guarded M1-02B live acceptance

Run the live workflow only after fixture application is successful. Supply the exact currently deployed SHA and enter:

```text
RUN_M1_02B_LIVE_INCIDENT
```

The workflow then:

1. proves the immutable running image matches `expected_sha`, the environment/fixture policy is complete, no live or recovery-required run exists, and the mutation switch is the only remaining static blocker;
2. takes an exact mode-`0600` backup of `.env` and creates an exclusive 15-minute server lease;
3. starts a detached lease watchdog;
4. enables the mutation switch only for that lease and recreates the same NVS image;
5. runs confirmed read-only actor/resource readiness;
6. starts one deterministic `payment-api-service-degradation / journey=normal` live run;
7. polls the durable NVS checkpoint until `COMPLETED` or `RECOVERY_REQUIRED`;
8. stores the detailed sanitized run report privately under `/opt/nvs/releases`;
9. restores the exact original `.env`, recreates the same image, and verifies that mutation is disabled again.

The GitHub summary never prints the Incident UUID or number. It reports only the run ID, final verdict/error code, required-step counts, cleanup policy/status, and final Incident disposition.

Two successful acceptance classifications are recognized:

- `PASS` when the actual NILES authority contract permits every required step and the declared retained-closed policy is satisfied;
- `ACCEPTED_WITH_PRODUCT_BLOCKER` when all required pre-close steps pass, requester close is truthfully blocked with `NILES_CLOSE_AUTHORITY_UNSATISFIABLE`, and the run-owned Incident is verified deleted under `DELETE_IF_RUN_OWNED`.

Any other `FAIL`, `BLOCKED`, timeout, unknown create outcome, incomplete cleanup, or recovery-required checkpoint fails the workflow. The `always()` cleanup step invokes `force-disable`, and the detached watchdog independently restores the original environment if the GitHub runner disappears.

## Security boundaries

- All workflows are manual-only and refuse to run from a branch other than `main`.
- Jobs use the protected `staging` GitHub environment and the same pinned SSH trust contract as deployment.
- Fixture application and live acceptance share one GitHub concurrency group so they cannot overlap.
- Reviewed scripts are checked out from `main`, copied to a mode-`0700` temporary server directory, and removed after the operation.
- Discovery runs inside the existing NVS container so it reaches NILES only through the approved private Docker network.
- Credentials and bearer material stay in process memory and are never serialized.
- Read-only operations do not write `/opt/nvs/.env`, `/opt/nvs/config`, `/opt/nvs/data`, or a NILES business endpoint.
- Fixture application writes only reviewed NVS config files and rollback snapshots; it never writes `.env` or NILES.
- Live acceptance is the only browser workflow that temporarily edits `.env`; it restores the exact original bytes and never commits or prints them.
- Production environments remain forbidden and port `4100` remains loopback-only.

Interactive web-console access still requires an approved SSH tunnel or a separately approved authenticated reverse proxy. Do not publish port `4100` directly.
