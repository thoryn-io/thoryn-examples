# Contributing a recipe

A recipe validates the Thoryn product **as it exists today**, using only supported product APIs.
This is the one hard rule; everything else is convention.

## The hard rule — stay inside the product boundary

- Every step `action`, `verify` `assert`, and `teardown` `action` MUST be one of the values in the
  **closed allowlist** in [`schema/recipe.schema.json`](schema/recipe.schema.json). Each maps to a
  supported product API.
- If your example needs something the product can't do through a supported API, that is a **product
  gap to report** (open a Jira ticket / issue), not a recipe to hack around it. Do not add a step
  that seeds a database, calls a demo/backdoor endpoint, or hardcodes state.
- Secrets are **never** written into a recipe. Server-minted secrets are returned once and written to
  a file by the CLI; a recipe only references ids, never secret values.
- **Two files per example (SSO-3087, amended 2026-09-15).** `recipes/<id>/provision.yaml` is *how to get
  Thoryn up and running* for the example — the sandbox, the loopback client, the demo user, the sign-in
  methods, the look-and-feel, … (schema `schema/provision.schema.json`, a closed `kind` allowlist, secrets
  only as env-var NAMES); it is the file a customer copies into their own `.thoryn/`. `recipes/<id>/recipe.yaml`
  is *how to get the example configured*: `provision: ./provision.yaml` plus the extra steps beyond the
  provisioning (params that feed the provision file's placeholders, the RP asset, `run`/`verify`).
  `thoryn examples apply` converges the provision file FIRST, then the recipe's extras; `teardown` destroys it.

## Adding a recipe

1. Create `recipes/<id>/provision.yaml` (how to get Thoryn up and running for the example) and
   `recipes/<id>/recipe.yaml` (how to get the example configured; it references the provision file) —
   see [`recipes/sandbox-signin/`](recipes/sandbox-signin/).
2. Add `recipes/<id>/README.md` describing what it provisions and how to run it.
3. If it needs a runnable app (e.g. a relying party), put it under `recipes/<id>/apps/`.
4. Validate locally against the schema (CI runs the same check):
   ```bash
   npx --yes ajv-cli@5 validate -s schema/recipe.schema.json -d "recipes/**/recipe.yaml" --spec=draft2020 -c ajv-formats
   npx --yes ajv-cli@5 validate -s schema/provision.schema.json -d "recipes/**/provision.yaml" --spec=draft2020
   ```
5. (Optional, recommended for user-facing flows) add a **colocated** browser E2E under
   `recipes/<id>/e2e/` — — a `scenario.mjs` (declared steps) + a `*-journey.spec.ts` that
   imports the shared harness from the repo-root [`e2e/`](e2e/) tree (config + Mailpit
   capture), and wire it as a project in [`e2e/playwright.config.ts`](e2e/playwright.config.ts).
   Seed its report with `npm run results:init`. See [`e2e/README.md`](e2e/README.md). Keep
   shared setup in `e2e/` — don't copy it into the recipe.

## Recipe fields (summary)

| Field | Meaning |
|-------|---------|
| `apiVersion` | `thoryn.io/examples/v1` |
| `id` / `version` / `summary` | identity + a one-line description |
| `params` | typed inputs (`prompt`, optional `default`, `validate` regex, `secret`); referenced as `{{name}}`. `{{generate.slug8}}` / `{{generate.uuid}}` produce fresh values. |
| `provision` | recipe-relative path to the provisioning file `examples apply` converges first; its resources are addressable as `{{provision.<kind>.<name>.<field>}}` |
| `steps` | ordered EXTRA actions beyond the provisioning (optional when `provision` is set); a step's outputs are addressable as `{{<step id>.<field>}}` |
| `verify` | read-only assertions that must pass |
| `teardown` | best-effort removal (reverse order) |
| `assets` | recipe-relative paths (a runnable app, docs) |

## Style

- Keep a recipe small and focused on one outcome a developer wants to see.
- Prefer a fresh, disposable workspace (a `{{generate.slug8}}` slug) so runs don't collide.
- Write `summary` and `README.md` from the reader's point of view — what they'll see, not how it's wired.
