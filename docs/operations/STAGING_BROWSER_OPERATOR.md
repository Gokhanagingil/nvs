# Browser-only staging operator

The NVS control plane remains bound to the staging host loopback interface. This workflow provides a safe browser-triggered operator path for days when an approved workstation cannot open an SSH tunnel.

Use **Actions → staging operator → Run workflow** on the `main` branch.

## Operations

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

## Security boundaries

- The workflow is manual-only and refuses to run from a branch other than `main`.
- The job uses the protected `staging` GitHub environment and the same pinned SSH trust contract as deployment.
- Reviewed scripts are checked out from `main`, copied to a mode-`0700` temporary server directory, and removed after the operation.
- Discovery runs inside the existing NVS container so it reaches NILES only through the approved private Docker network.
- Neither operation writes `/opt/nvs/.env`, `/opt/nvs/config`, `/opt/nvs/data`, or a NILES business endpoint.
- The only discovery write is the mode-`0600` sanitized report under `/opt/nvs/releases`.
- `NVS_ENABLE_NILES_MUTATIONS` is never changed by this workflow.

Interactive web-console access still requires an approved SSH tunnel or a separately approved authenticated reverse proxy. Do not publish port `4100` directly.
