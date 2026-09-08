# Thoryn examples

The public catalog of **recipes** for the [`thoryn`](https://thoryn.org) customer-plane CLI.

A recipe is a declarative example: it provisions a real, working configuration in **your own**
Thoryn account using only supported product APIs, lets you see it work, and tears it down. The
`thoryn examples` command applies a recipe for you and (soon) records a verifiable **receipt** of
exactly what it configured.

> Status: this repository is the authoring home for recipes. Today the `thoryn` CLI ships recipes
> bundled; fetching signed recipes from this repo, and receipts, land in upcoming CLI phases
> (tracked under Jira epic SSO-2871). Sections marked _(roadmap)_ describe that near-term direction.

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

## Run a recipe _(roadmap)_

```bash
thoryn examples catalog            # list recipes from this repo
thoryn examples apply simple-signin
thoryn examples verify             # re-check the live config matches the recipe
thoryn examples teardown simple-signin
```

Today, run the bundled example with `thoryn examples setup simple-signin` → `run` → `teardown`.

## Recipes

| id | summary |
|----|---------|
| [`simple-signin`](recipes/simple-signin/) | Provision a workspace + app, then register & sign a user in to a protected page. |

## Conformance

Every recipe is exercised end-to-end against staging by `.github/workflows/conformance.yml`
(nightly + on demand): it builds the `thoryn` CLI, signs in as a client-credentials service
account, and runs each recipe **apply → verify → teardown**. A recipe that has drifted from the
product fails here — a red recipe blocks a release. Provision the workflow's secrets
(`THORYN_CI_CLIENT_ID`, `THORYN_CI_CLIENT_SECRET`, `OATHY_CLI_TOKEN`) once; see the workflow
header.

### Browser e2e (`example-e2e.yml`) — _scaffold, not yet activated_

`.github/workflows/example-e2e.yml` (SSO-2909 / SSO-2912) goes one step further than
conformance: it drives `simple-signin` through a **real browser** against staging — a
genuine self-service sign-up whose **verification email is captured from an ephemeral,
in-job [Mailpit](https://mailpit.axllent.org/) sink** (via the tenant's BYO-SMTP,
SSO-2917) — then signs in through the recipe's loopback RP to a protected page. The
harness lives in [`e2e/`](e2e/).

The sink is **fully ephemeral — no external service, no VM**: the workflow runs Mailpit
as a Docker container inside the runner and opens a **public TCP tunnel** (ngrok by
default; `bore.pub` no-account fallback) to its SMTP port so staging's identity can
deliver the email; the harness reads it back over Mailpit's **local** API. Everything is
torn down with the job. The SMTP hop over the tunnel is plaintext (the tunnel can't
present a STARTTLS cert for its ephemeral host) — fine for a throwaway TEST mailbox.

It is a **scaffold**: `workflow_dispatch` + nightly, and it fails at the WIF login step
until a maintainer creates **three** repo secrets — `THORYN_CI_WIF_SIGNING_KEY`,
`OATHY_CLI_TOKEN`, and `NGROK_AUTHTOKEN` (free ngrok account; unneeded if you set the
repo variable `SINK_TUNNEL=bore`) — and a first live run confirms the tenant
self-service-signup entry, the BYO-SMTP→tunnel→Mailpit delivery, and the RP OIDC
round-trip. See [`e2e/README.md`](e2e/README.md) for the full secret table and the
live-confirm list.

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE).
