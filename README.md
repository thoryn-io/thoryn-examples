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

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE).
