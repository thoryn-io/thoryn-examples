# Example e2e harness (SSO-2909 / SSO-2912)

> **SCAFFOLD — NOT YET ACTIVATED.** This harness drives the `simple-signin` example
> end-to-end against the **staging SaaS** in a real browser. It cannot go green until a
> maintainer creates the CI secrets below **and** a first live run confirms the three
> `LIVE-CONFIRM` seams noted in the spec. Until then `.github/workflows/example-e2e.yml`
> is `workflow_dispatch`-only and will fail at the WIF login step.

A Playwright harness that runs the **Path B** journey: a genuine self-service sign-up
of a brand-new end user on a freshly-provisioned workspace, capturing the **real
verification email** from a managed **Mailtrap Email Testing** inbox so the flow can
proceed — no DB injection, no stubbing.

## The journey (`tests/simple-signin-journey.spec.ts`)

1. Open the recipe's **real loopback RP** (`../recipes/simple-signin/apps/loopback-rp/server.js`):
   `/` → "Sign in with Thoryn" → `{workspace-issuer}/oauth2/authorize` → the workspace
   hub federates to the tenant's identity → its hosted login renders.
2. Follow the hosted login's self-service **Sign up** path → register a unique email
   → "Check your email".
3. Poll **Mailtrap's API** until the verification email to that address lands; extract
   the real `/verify-email?token=…` link.
4. Follow the link → "Your email is verified".
5. Return to the RP → sign in with the verified creds → callback → RP `/protected`
   renders the ID-token claims (asserts the email is shown).

## Layout

| Path | Purpose |
|---|---|
| `lib/config.ts` | staging + Mailtrap + RP URLs, env-overridable |
| `lib/verification-link.mjs` | the pure verify-link parse seam (single source of truth) |
| `lib/mailbox.ts` | Mailtrap Email Testing API capture (list → body → parse) |
| `lib/mailbox.parse.test.mjs` | `node:test` unit for the parse seam — runs WITHOUT creds |
| `tests/simple-signin-journey.spec.ts` | the Path-B journey + a garbage-token error path |

## Run

```sh
npm ci

# The one thing runnable without staging creds — the parse-seam unit test:
npm run test:unit

# Type-check the harness:
npm run typecheck

# Against staging (needs a provisioned workspace + a running loopback RP + a Mailtrap inbox):
RP_BASE_URL=http://127.0.0.1:8471 \
THORYN_ISSUER=https://<workspace>.hub.stg.thoryn.org \
THORYN_CLIENT_ID=app-XXXXXXXX \
IDENTITY_BASE_URL=https://identity.stg.thoryn.org \
MAILTRAP_ACCOUNT_ID=<id> MAILTRAP_INBOX_ID=<id> MAILTRAP_API_TOKEN=<token> \
npm run install-browser && npm test
```

The full CI orchestration lives in
[`../.github/workflows/example-e2e.yml`](../.github/workflows/example-e2e.yml).

## Secrets a maintainer must create to activate

The workflow references these repo secrets. Until they exist it is
`workflow_dispatch`-only and fails at the login step. Create them under
**Settings → Secrets and variables → Actions**:

| Secret | What it is |
|---|---|
| `THORYN_CI_WIF_SIGNING_KEY` | EC P-256 (ES256) **private** key (PKCS#8 PEM) for the `conformance-ci-github-wif` exchange client. Public half is registered on the hub (oathy migration; subject pinned to `repo:thoryn-io/thoryn-examples:*`). Same secret the `conformance.yml` workflow uses. |
| `OATHY_CLI_TOKEN` | A token (PAT / GitHub App) that can read `thoryn-io/oauthy` **releases**, to download the prebuilt `thoryn.jar` (`cli-v*` release). Same as `conformance.yml`. |
| `MAILTRAP_API_TOKEN` | Mailtrap **Email Testing** API token (sent as the `Api-Token` header). |
| `MAILTRAP_ACCOUNT_ID` | Mailtrap account id (the `/api/accounts/{id}` path segment). |
| `MAILTRAP_INBOX_ID` | Mailtrap Email-Testing inbox id to capture from. |
| `MAILTRAP_SMTP_HOST` | Mailtrap sandbox SMTP host, e.g. `sandbox.smtp.mailtrap.io`. |
| `MAILTRAP_SMTP_PORT` | Mailtrap sandbox SMTP port, e.g. `587` (STARTTLS) or `2525`. |
| `MAILTRAP_SMTP_USERNAME` | The inbox's SMTP username (from the inbox's SMTP settings). |
| `MAILTRAP_SMTP_PASSWORD` | The inbox's SMTP password. |

The Mailtrap SMTP host is **public**, so the tenant BYO-SMTP guard (`SmtpTargetGuard`)
allows it with no allow-list entry.

## What only a first live run can confirm

- **WIF trust** — GitHub OIDC from `thoryn-io/thoryn-examples` is accepted by the
  staging hub for the required audience (oathy V148 per-environment WIF audience).
- **The tenant self-service-signup entry** — that the workspace's cloned identity
  member exposes a self-service "Sign up" link from its hosted login, and its exact
  accessible name / form selectors (`gotoRegisterFromLogin`).
- **BYO-SMTP → Mailtrap delivery** — that `thoryn workspace email-provider set`
  actually routes the verification email to the Mailtrap inbox.
- **The RP OIDC round-trip** — that the freshly-verified account authenticates through
  the workspace hub federation and lands on the RP's `/protected` page.
