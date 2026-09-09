# Thoryn examples

The public catalog of **recipes** for the [`thoryn`](https://thoryn.org) customer-plane CLI.

A recipe is a declarative example: it provisions a real, working configuration in **your own**
Thoryn account using only supported product APIs, lets you see it work, and tears it down. The
`thoryn examples` command applies a recipe for you and records a verifiable **receipt** of exactly
what it configured.

> Status: this repository is the authoring home for recipes. The released `thoryn` CLI ships recipes
> **bundled** — `thoryn examples apply / verify / teardown / receipt` drive them today (they run in
> nightly conformance against staging). Fetching signed recipes _from this repo_ at runtime is the
> remaining roadmap item (tracked under Jira epic SSO-2871); sections marked _(roadmap)_ describe
> that near-term direction.

## Get the CLI

The `thoryn` CLI is released from **[`thoryn-io/thoryn-cli`](https://github.com/thoryn-io/thoryn-cli)**
(the customer-plane CLI was extracted there — SSO-2934/2935/2940; it is no longer built from the
`oathy` monorepo). Install the latest release:

```bash
# Homebrew (macOS / Linux) — recommended
brew tap thoryn-io/thoryn-cli
brew install thoryn

# Or grab a prebuilt binary / jar from the latest `cli-v*` GitHub Release
#   https://github.com/thoryn-io/thoryn-cli/releases   (current: cli-v0.2.0)
#   assets: per-OS native binaries, plus a portable `thoryn.jar` (needs Java 21)
```

CI downloads the portable `thoryn.jar` asset from the latest `cli-v*` release automatically (see
**Conformance** below).

## Layout

```
schema/recipe.schema.json          # the recipe format (JSON Schema, draft 2020-12)
recipes/<id>/recipe.yaml           # a recipe (authored in YAML)
recipes/<id>/README.md             # what the recipe does + how to run it
recipes/<id>/apps/…                # runnable assets (e.g. a loopback relying-party app)
.github/workflows/ci.yml           # validates every recipe against the schema
```

## What a recipe looks like

```yaml
apiVersion: thoryn.io/examples/v1
id: simple-signin
version: 1.0.0
summary: Provision a workspace + app, then register & sign a user in to a protected page.
params:
  - { name: workspaceSlug, prompt: "Workspace slug", default: "ex-signin-{{generate.slug8}}" }
steps:
  - { id: workspace, action: hub.createWorkspace, with: { slug: "{{workspaceSlug}}" } }
  - { id: app,       action: applications.create, with: { clientType: public, redirectUris: [...] } }
verify:
  - { assert: applications.get, id: "{{app.clientId}}", expect: { status: active } }
teardown:
  - { action: applications.delete, id: "{{app.clientId}}" }
```

The step `action` (and `verify` `assert`, `teardown` `action`) values are a **closed allowlist** in
the schema, each mapping to a supported product API. This is deliberate: a recipe **cannot** express a
database seed, a demo endpoint, or any unsupported shortcut — it can only drive the product as it
exists. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Run a recipe

```bash
thoryn examples apply simple-signin      # provision the recipe in your own account
thoryn examples verify simple-signin     # re-check the live config matches the recipe
thoryn examples receipt simple-signin    # print the receipt of what was configured
thoryn examples teardown simple-signin   # remove everything the recipe created
```

These commands drive the recipes **bundled** in the released CLI (that is exactly what nightly
conformance exercises). `thoryn examples catalog` — listing / fetching signed recipes _from this
repo_ at runtime — is the remaining roadmap item _(SSO-2871)_.

## Recipes

| id | summary |
|----|---------|
| [`simple-signin`](recipes/simple-signin/) | Provision a workspace + app, then register & sign a user in to a protected page. |
| [`sandbox-signin`](recipes/sandbox-signin/) | Provision an ephemeral **sandbox environment** + a loopback OAuth client in it, then hard-delete both — per-run isolation without a new workspace. |

## Conformance

`.github/workflows/conformance.yml` (nightly + on demand) exercises a recipe **apply → verify →
teardown** against staging with the real `thoryn` CLI, so a product change that breaks the recipe's
product-API contract fails here — a red recipe blocks a release.

**CLI source.** The workflow downloads the prebuilt `thoryn.jar` from the **latest `cli-v*` release of
[`thoryn-io/thoryn-cli`](https://github.com/thoryn-io/thoryn-cli)** (which bundles the `ci-signin`
recipe it applies). The CLI is no longer built from the `oathy` monorepo.

**Auth (SSO-2942 — moved off Workload Identity Federation).** CI authenticates with a
**customer-plane `client_credentials` API key** the operator mints themselves — the model proven in
`thoryn-cli`'s provisioning Action. No GitHub OIDC, no `id-token` permission, no private signing key.
The key is **tenant-scoped** (bound to one **standing workspace** via its `tnt` claim) and signs in at
that workspace's per-tenant issuer (`https://<slug>.hub.stg.thoryn.org`).

> **Coverage note.** A tenant-scoped API key **cannot create workspaces** (workspace-create needs a
> machine scope a tenant admin can't delegate — the **SSO-2943** gap). So conformance no longer runs
> the repo's `simple-signin` recipe (its first step is `hub.createWorkspace`). It runs the
> **workspace-less `ci-signin` recipe** (bundled in the CLI) **inside the standing workspace**:
> `applications.create → applications.get (verify) → applications.delete`. The workspace-lifecycle,
> `identity.registerUser`, and email-provider steps of `simple-signin` are **not** conformance-covered
> under the API-key model.

Provision the workflow's config once (see **CI provisioning setup** below): the secrets
`THORYN_API_KEY`, `OATHY_CLI_TOKEN` and the repo variable `CI_WORKSPACE_SLUG`.

### Browser e2e (`example-e2e.yml`) — _live (nightly)_

`.github/workflows/example-e2e.yml` (SSO-2909 / SSO-2912; auth cutover SSO-2942) goes one step
further than conformance: it drives the `simple-signin` **browser journey** against staging — a
genuine self-service sign-up whose **verification email is captured from an ephemeral, in-job
[Mailpit](https://mailpit.axllent.org/) sink** (via the tenant's BYO-SMTP, SSO-2917) — then signs in
through the recipe's loopback RP to a protected page. The harness lives in [`e2e/`](e2e/).

Under the API-key model it provisions an **ephemeral OAuth app inside the standing workspace** (via
`ci-signin`) rather than a fresh workspace per run, and points that **standing workspace's BYO-SMTP at
the per-run tunnel** each run (the tunnel is ephemeral). The brand-new self-service user is created in
the standing workspace. _Cleanup caveat:_ the API key can't hard-delete the workspace the way the old
WIF flow did, so each run leaves one test user behind in the standing workspace (there is no
user-delete recipe action — the `ci-signin` limitation); prune periodically until a delete capability
lands.

The sink is **fully ephemeral — no external service, no VM**: the workflow runs Mailpit as a Docker
container inside the runner and opens a **public TCP tunnel** (ngrok by default; `bore.pub` no-account
fallback) to its SMTP port so staging's identity can deliver the email; the harness reads it back over
Mailpit's **local** API. Everything is torn down with the job. The SMTP hop over the tunnel is
plaintext (the tunnel can't present a STARTTLS cert for its ephemeral host) — fine for a throwaway
TEST mailbox.

It runs **nightly** (and on `workflow_dispatch`) and now passes on `main` once the operator has
completed **CI provisioning setup** (below). It still **fails at the sign-in step** in any fork/repo
that has not provisioned the standing workspace, the API key, and the secrets/vars. Note the workflow
file's own header still carries an older "scaffold — not yet activated" banner that predates the first
green live runs; the pipeline itself is live. See [`e2e/README.md`](e2e/README.md) for the full secret
table and the live-confirm list.

### Per-example sandbox e2e (`sandbox-e2e.yml`) — _scaffold (workflow_dispatch + nightly)_

`.github/workflows/sandbox-e2e.yml` (SSO-2962, epic SSO-2959) gives each run its **own isolation**
without a new tenant: it applies the [`sandbox-signin`](recipes/sandbox-signin/) recipe, which
provisions a **fresh sandbox environment** inside the standing workspace (`env.create`), provisions a
loopback OAuth client **into that sandbox** (`applications.create`), verifies the client is active
(`applications.get`), then hard-deletes **both** the client and the sandbox (`applications.delete` →
`env.delete`, in an `if: always()` step so a failed run still cleans up). This sidesteps the SSO-2943
workspace-create gap by reusing the connection contract's tenant-scoped key, which already holds
`tenant:environments.write`. Sign-in requests exactly `tenant:environments.write
tenant:applications.write tenant:applications.read`.

`env.delete` (product-api `DELETE /api/v1/environments/{id}`, SSO-2960) is **sandbox-only** and
name-confirmation-guarded: the interpreter sends the environment's **own slug** as `X-Thoryn-Confirm`
(resolved from the run state it recorded at `env.create`; 428 absent / 422 mismatch), so the recipe
teardown references only `{{env.id}}`.

> **Scaffold.** A first LIVE `workflow_dispatch` run is a follow-up: it needs the thoryn CLI with the
> `env.create` / `env.delete` recipe actions published as a `cli-v*` release (**cli-v0.3.5**) **plus**
> the same standing workspace + API key + repo config as the other suites (below). Until then the
> workflow is `workflow_dispatch`-only and fails at the sign-in step.

## CI provisioning setup _(operator-run, one-time)_

Both CI suites authenticate as a real customer with a tenant-scoped `client_credentials` API key
against a **standing workspace on staging that the operator owns** (the model proven in `thoryn-cli`).
This is **operator-run** setup — it mutates a real staging tenant and mints a real credential. Run it
once as a tenant admin (commands target staging; adjust the issuer for another environment):

```bash
# 0) Sign in interactively as a tenant admin (authorization-code + PKCE, opens a browser).
thoryn login --issuer https://hub.stg.thoryn.org

# 1) Create the STANDING workspace the CI runs provision into (skip if it exists).
thoryn workspace create --slug ci-conformance --display-name "CI conformance"

# 2) Enter it, so the API key is registered UNDER that tenant (its `tnt`).
thoryn workspace switch ci-conformance

# 3) Mint the CUSTOMER-PLANE client_credentials API key, scoped to the UNION all suites need:
#    conformance → tenant:applications.write + tenant:applications.read;
#    example-e2e  → the same + tenant:email.write (to point the workspace BYO-SMTP at the sink);
#    sandbox-e2e  → the same + tenant:environments.write (create/delete the per-run sandbox).
#    The secret is written to a FILE (never printed to a log/pipe). --scope is REPEATABLE.
#    NOTE (SSO-2943 friction): `clients create` REQUIRES --redirect-uri even for a machine
#    (client_credentials) client that never redirects — pass a throwaway.
thoryn clients create \
  --display-name "CI provisioning key (ci-conformance)" \
  --client-type confidential \
  --grant-type client_credentials \
  --scope tenant:applications.write \
  --scope tenant:applications.read \
  --scope tenant:email.write \
  --scope tenant:environments.write \
  --redirect-uri https://ci.invalid/unused \
  --secret-file ci-api-key.secret
# → prints the client-id; the secret is in ci-api-key.secret.
```

Then set the repo Actions config (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|------|------|-------|
| secret | `THORYN_API_KEY` | `<client-id>:<contents of ci-api-key.secret>` from step 3 |
| secret | `OATHY_CLI_TOKEN` | a PAT / GitHub App token that can read `thoryn-io/thoryn-cli` **releases** (to download the prebuilt `thoryn.jar`) |
| secret | `NGROK_AUTHTOKEN` | free [ngrok](https://ngrok.com) authtoken (**example-e2e only**; skip if `SINK_TUNNEL=bore`) |
| variable | `CI_WORKSPACE_SLUG` | the standing workspace slug (e.g. `ci-conformance`) |
| variable | `SINK_TUNNEL` | `bore` to use the account-less tunnel instead of ngrok (optional) |

Delete `ci-api-key.secret` after setting the repo secret. Rotate the key with
`thoryn clients rotate-secret <client-id> --secret-file <path>` (old secret stays valid 24h) and
update `THORYN_API_KEY`.

**SSO-2943 gaps to validate on the first live run** (this story is thoryn-examples-only and does NOT
touch oauthy):

- Confirm the hub **issues a usable tenant-scoped token** for a customer-plane `client_credentials`
  client registered in a non-default tenant, authenticating at `https://<slug>.hub.stg.thoryn.org` —
  the whole model turns on this.
- A tenant-scoped key **cannot create workspaces**, so conformance runs the workspace-less `ci-signin`
  recipe and example-e2e leaks one self-service test user per run into the standing workspace (no
  user-delete recipe action). Track/close these on **SSO-2943**.
- **Release prerequisite — satisfied:** `examples apply ci-signin` needs the `ci-signin` recipe
  **bundled in the released `thoryn` CLI jar**. The CLI now releases from
  [`thoryn-io/thoryn-cli`](https://github.com/thoryn-io/thoryn-cli) (latest `cli-v0.2.0`), which
  bundles `ci-signin`, and both suites are green nightly on `main`.

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE).
