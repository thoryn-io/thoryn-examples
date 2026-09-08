# Example e2e harness (SSO-2909)

> **SCAFFOLD — NOT YET FUNCTIONAL.** This harness has never been run against a live
> cluster. It cannot go green today. See [`../docs/ci-e2e-plan.md`](../docs/ci-e2e-plan.md)
> for the feasibility verdict and the blocker list.

A Playwright harness that drives the `simple-signin` example end-to-end in a real
browser against the **browsable published stack**, capturing the **real
verification email** so a genuine self-service sign-up can proceed (**Path B**).

## The journey (`tests/simple-signin-journey.spec.ts`)

1. Self-service sign-up on identity `/register` → "check your email".
2. Poll Mailpit's HTTP API until the verification email lands; extract the real
   `/verify-email?token=…` link.
3. Follow the link → "your email is verified".
4. Drive the recipe's **real loopback RP**
   (`../recipes/simple-signin/apps/loopback-rp/server.js`): `/` → "Sign in with
   Thoryn" → `{workspace-issuer}/oauth2/authorize` → hub federates to identity →
   sign in → callback → RP `/protected` renders the ID-token claims.

## Layout

| Path | Purpose |
|---|---|
| `lib/config.ts` | nip.io + Mailpit + RP URLs, env-overridable |
| `lib/verification-link.mjs` | the pure verify-link parse seam (single source of truth) |
| `lib/mailpit.ts` | Mailpit search-API capture (mirrors oathy's proven SSO-2816 helpers) |
| `lib/mailpit.parse.test.mjs` | `node:test` unit for the parse seam — runs WITHOUT a cluster |
| `tests/simple-signin-journey.spec.ts` | the Path-B journey + a garbage-token error path |
| `cluster/mailpit.yaml` | Mailpit test-SMTP manifest (vendored from oathy) |
| `cluster/values-example.yaml` | browsable overlay for the packaged chart (INCOMPLETE — see BLOCKED markers) |

## Run

```sh
npm ci

# The one thing runnable without a cluster — the parse-seam unit test:
npm run test:unit

# Type-check the harness:
npm run typecheck

# Against a live browsable stack (needs the deployed cluster + a running loopback RP):
RP_BASE_URL=http://127.0.0.1:8471 \
IDENTITY_BASE_URL=https://identity.127.0.0.1.nip.io \
MAILPIT_BASE_URL=https://mailpit.127.0.0.1.nip.io \
THORYN_ISSUER=https://<workspace>.hub.127.0.0.1.nip.io \
THORYN_CLIENT_ID=app-XXXXXXXX \
npm run install-browser && npm test
```

The full CI orchestration lives in
[`../.github/workflows/example-e2e.yml`](../.github/workflows/example-e2e.yml).
