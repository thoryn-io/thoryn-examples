# Example e2e harness (SSO-2909 / SSO-2912 / SSO-2942)

> **SCAFFOLD — NOT YET ACTIVATED.** This harness drives the `simple-signin` browser
> journey end-to-end against the **staging SaaS** in a real browser. It cannot go green
> until the operator completes the one-time **CI provisioning setup** (standing workspace
> + `client_credentials` API key — see the repo [`README.md`](../README.md)) **and** a
> first live run confirms the three `LIVE-CONFIRM` seams noted in the spec. Until then
> `.github/workflows/example-e2e.yml` is `workflow_dispatch`-only and will fail at the
> sign-in step.

A Playwright harness that runs the **Path B** journey: a genuine self-service sign-up
of a brand-new end user on a **standing workspace** (into which the run provisions an
ephemeral OAuth app), capturing the **real verification email** from an **ephemeral,
in-job [Mailpit](https://mailpit.axllent.org/)** sink so the flow can proceed — no DB
injection, no stubbing.

> **Auth (SSO-2942).** The workflow moved **off Workload Identity Federation** onto a
> **customer-plane `client_credentials` API key** scoped to the standing workspace (the
> model proven in `thoryn-cli`). The key authenticates at the workspace's per-tenant
> issuer requesting `tenant:applications.write` + `tenant:applications.read` +
> `tenant:email.write`. Because a tenant-scoped key **cannot create workspaces**, the run
> provisions an **ephemeral app inside the standing workspace** (`ci-signin`) and points
> that workspace's **BYO-SMTP at the per-run tunnel** each run — it does not mint (or
> hard-delete) a fresh workspace. One self-service test user is therefore left behind per
> run (no user-delete recipe action — SSO-2943).

## The mail sink is ephemeral and lives in the CI job — no external service, no VM

There is **no Mailpit server to run and no mail account to buy** (product-owner
decision). The workflow itself:

1. Starts **Mailpit as a Docker container inside the runner** — `:1025` is SMTP, `:8025`
   is the HTTP API.
2. Opens a **public TCP tunnel** to Mailpit's SMTP port (`:1025`) for the duration of
   the run. A GitHub-hosted runner has no public inbound, but the tenant's BYO-SMTP
   (SSO-2917) must reach the sink over **public SMTP** — the tunnel gives it a public
   `host:port` that forwards to the in-job Mailpit. `SmtpTargetGuard` allows it because
   the tunnel host is public; staging egress is open.
3. Points the workspace BYO-SMTP at that tunnel, so identity delivers the verification
   email over real SMTP into the container.
4. Reads the captured mail over Mailpit's **local** API (`http://localhost:8025`, no
   auth). The tunnel is SMTP-only; the read side never leaves localhost.
5. Tears everything down when the job ends (the container and tunnel die with the
   runner).

### Tunnel: ngrok (default) or bore.pub (no account)

The default tunnel is **ngrok**, which needs a free account and one secret,
`NGROK_AUTHTOKEN`. A **no-account fallback** is **[`bore`](https://github.com/ekzhang/bore)**
(`bore local 1025 --to bore.pub` → `bore.pub:<port>`, no token). Swapping between them is
a small, documented change: set the repo **variable** `SINK_TUNNEL=bore` (Settings →
Secrets and variables → Actions → *Variables*) and the workflow uses `bore.pub` instead
— `NGROK_AUTHTOKEN` is then unnecessary. Default is `ngrok`.

### Plaintext-over-tunnel caveat

The BYO-SMTP leg uses `--transport-security none --allow-insecure`. An ngrok/bore TCP
tunnel forwards raw bytes and **cannot present a valid STARTTLS cert for its ephemeral
hostname**, so the SMTP hop is plaintext. This is acceptable **only** because the sink is
a throwaway TEST mailbox that receives a single verification email per run and holds
nothing sensitive — it is never a pattern for a production SMTP provider. Mailpit is
started with `MP_SMTP_AUTH_ALLOW_INSECURE=true` for the same reason, and its SMTP
username/password is a per-run value (`openssl rand -hex 16`) fed to the CLI through a
`0600` tmp file (never on argv — the CLI has no `--smtp-password <value>` flag).

## The journey (`tests/simple-signin-journey.spec.ts`)

1. Open the recipe's **real loopback RP** (`../recipes/simple-signin/apps/loopback-rp/server.js`):
   `/` → "Sign in with Thoryn" → `{workspace-issuer}/oauth2/authorize` → the workspace
   hub federates to the tenant's identity → its hosted login renders.
2. Follow the hosted login's self-service **Sign up** path → register a unique email
   → "Check your email".
3. Poll the **local Mailpit API** until the verification email to that address lands;
   extract the real `/verify-email?token=…` link.
4. Follow the link → "Your email is verified".
5. Return to the RP → sign in with the verified creds → callback → RP `/protected`
   renders the ID-token claims (asserts the email is shown).

## Layout

| Path | Purpose |
|---|---|
| `lib/config.ts` | staging + Mailpit + RP URLs, env-overridable |
| `lib/verification-link.mjs` | the pure verify-link parse seam (single source of truth) |
| `lib/mailbox.ts` | Mailpit HTTP-API capture (search → body → parse; list fallback) |
| `lib/mailbox.parse.test.mjs` | `node:test` unit for the parse seam — runs WITHOUT creds |
| `tests/simple-signin-journey.spec.ts` | the Path-B journey + a garbage-token error path |

## Run

```sh
npm ci

# The one thing runnable without staging creds — the parse-seam unit test:
npm run test:unit

# Type-check the harness:
npm run typecheck

# Against staging (needs a provisioned workspace, a running loopback RP, and a local
# Mailpit the workspace BYO-SMTP can reach — e.g. `docker run -p 1025:1025 -p 8025:8025
# axllent/mailpit` plus your own tunnel to :1025). MAILPIT_BASE_URL defaults to the
# local API, so you rarely need to set it:
RP_BASE_URL=http://127.0.0.1:8471 \
THORYN_ISSUER=https://<workspace>.hub.stg.thoryn.org \
THORYN_CLIENT_ID=app-XXXXXXXX \
IDENTITY_BASE_URL=https://identity.stg.thoryn.org \
MAILPIT_BASE_URL=http://localhost:8025 \
npm run install-browser && npm test
```

The full CI orchestration lives in
[`../.github/workflows/example-e2e.yml`](../.github/workflows/example-e2e.yml).

## Config a maintainer must create to activate

The full **CI provisioning setup** (standing workspace + `client_credentials` API key) lives in
the repo [`README.md`](../README.md). Beyond that one-time setup the workflow references the repo
config below. Until it exists the workflow is `workflow_dispatch`-only and fails at the sign-in step.
Set it under **Settings → Secrets and variables → Actions**:

| Kind | Name | Required | What it is |
|---|---|---|---|
| secret | `THORYN_API_KEY` | yes | `<client-id>:<client-secret>` of the customer-plane `client_credentials` API key scoped to the standing workspace, granted `tenant:applications.write` + `tenant:applications.read` + `tenant:email.write`. Same secret `conformance.yml` uses. |
| secret | `OATHY_CLI_TOKEN` | yes | A token (PAT / GitHub App) that can read `thoryn-io/oauthy` **releases**, to download the prebuilt `thoryn.jar` (`cli-v*` release). Same as `conformance.yml`. |
| secret | `NGROK_AUTHTOKEN` | yes¹ | Authtoken for a **free** [ngrok](https://ngrok.com) account — used to open the public TCP tunnel to the in-job Mailpit SMTP port. |
| variable | `CI_WORKSPACE_SLUG` | yes | Slug of the standing workspace the API key is scoped to (e.g. `ci-conformance`). |
| variable | `SINK_TUNNEL` | no | Set to `bore` for the account-less `bore.pub` tunnel (then `NGROK_AUTHTOKEN` is unneeded). |

¹ Not needed if you set the repo **variable** `SINK_TUNNEL=bore` (the account-less
`bore.pub` fallback). No Mailpit / SMTP secrets are needed at all — the sink is created
inside the job, and its SMTP password is generated per run.

## What only a first live run can confirm

- **Tenant-scoped API-key sign-in** — that the staging hub issues a usable token for the
  customer-plane `client_credentials` key authenticating at the standing workspace's
  per-tenant issuer `https://<slug>.hub.stg.thoryn.org` (the model turns on this — SSO-2943).
- **The tenant self-service-signup entry** — that the standing workspace's identity
  member exposes a self-service "Sign up" link from its hosted login, and its exact
  accessible name / form selectors (`gotoRegisterFromLogin`).
- **BYO-SMTP → tunnel → Mailpit delivery** — that `thoryn workspace email-provider set`
  against the standing workspace routes the verification email through the tunnel to the
  in-job Mailpit sink (and that a plaintext relay to the tunnel is accepted).
- **The RP OIDC round-trip** — that the freshly-verified account authenticates through
  the workspace hub federation and lands on the RP's `/protected` page.
