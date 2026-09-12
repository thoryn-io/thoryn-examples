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

## Adding a recipe

1. Create `recipes/<id>/recipe.yaml` (see [`recipes/simple-signin/recipe.yaml`](recipes/simple-signin/recipe.yaml)).
2. Add `recipes/<id>/README.md` describing what it provisions and how to run it.
3. If it needs a runnable app (e.g. a relying party), put it under `recipes/<id>/apps/`.
4. Validate locally against the schema (CI runs the same check):
   ```bash
   npx --yes ajv-cli@5 validate -s schema/recipe.schema.json -d "recipes/**/recipe.yaml" --spec=draft2020 -c ajv-formats
   ```
5. (Optional, recommended for user-facing flows) add a **colocated** browser E2E under
   `recipes/<id>/e2e/` — a `scenario.mjs` (declared steps) + a `*-journey.spec.ts` that
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
| `steps` | ordered actions; a step's outputs are addressable as `{{<step id>.<field>}}` |
| `verify` | read-only assertions that must pass |
| `teardown` | best-effort removal (reverse order) |
| `assets` | recipe-relative paths (a runnable app, docs) |

## Style

- Keep a recipe small and focused on one outcome a developer wants to see.
- Prefer a fresh, disposable workspace (a `{{generate.slug8}}` slug) so runs don't collide.
- Write `summary` and `README.md` from the reader's point of view — what they'll see, not how it's wired.
