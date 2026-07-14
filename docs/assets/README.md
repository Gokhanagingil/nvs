# NVS UI captures

These screenshots are generated from the local NVS control plane and sanitized example inputs. They contain no live NILES data.

M1-01 scenario/run/evidence captures can be regenerated while `corepack pnpm dev` is running:

```bash
corepack pnpm screenshots
```

`m1-02a-actor-readiness.png` is captured from the exact production container with no actor credentials configured. After starting that image on port 4100, regenerate it with:

```bash
corepack pnpm exec playwright screenshot --device="Desktop Chrome" --full-page \
  http://127.0.0.1:4100/environments \
  docs/assets/m1-02a-actor-readiness.png
```

Review every capture before committing it. No screenshot may contain a real login identifier, credential, bearer/session material, or live NILES business data.
