# `sandbox-signin` example (per-run ephemeral sandbox, setup → run → teardown)

A declarative Thoryn example recipe that gives every run its **own isolation** by provisioning a
throwaway **sandbox environment** inside a workspace you already own, provisioning a public loopback
OAuth client **into that sandbox**, registering a **sign-in-able user**, then **signing in end to end**
through the recipe's loopback relying party — and hard-deleting **both** the client and the sandbox on
teardown. It uses only supported product workflows (recipes are data, not code; the CLI is the only
executor, dispatching on a closed action allowlist).

It exists for one reason:

> A customer-plane `client_credentials` API key is **tenant-scoped** — bound to one workspace via its
> `tnt` claim — and **cannot create workspaces** (workspace-create needs a machine scope a tenant
> admin cannot delegate; see SSO-2943). But it **can** create and delete **sandbox environments**
> inside its own workspace (`tenant:environments.write`). So per-example isolation is achieved with a
> per-run sandbox rather than a per-run workspace — no new tenant, no new credential, no new trust.

## Run it

With the `thoryn` CLI (the recipe is fetched from the signed catalog — `thoryn examples update` — it
is **not** bundled in the CLI):

```bash
thoryn examples update                                                   # refresh the signed catalog
thoryn examples setup    sandbox-signin --set workspaceSlug=<your-ws>    # sandbox + client + user
thoryn examples run      sandbox-signin                                  # opens your browser: sign in → /protected
thoryn examples teardown sandbox-signin                                  # delete the client + the sandbox
```

`thoryn examples apply` runs `setup` then `verify` in one step; `thoryn examples receipt sandbox-signin`
prints the secret-free record of what was provisioned (the sandbox environment + its issuer, and the
client id) that the `run` step and the CI workflow read.

## What it provisions

1. **A fresh sandbox environment** (`env.create`) — product-api `POST /api/v1/environments`
   (`tenant:environments.write`). The interpreter records its id/slug and switches the run's
   **effective environment** to the new slug, so every later step provisions into this sandbox.
2. **A public loopback OAuth client** (`applications.create`) — authorization-code + PKCE, redirecting
   to `http://127.0.0.1/callback`, with an OIDC RP-Initiated-Logout post-logout redirect URI —
   created **inside the sandbox** from step 1.
3. **A verified, sign-in-able user** (`identity.registerUser`) — product-api `POST /api/v1/users`
   (`tenant:users.write`), so `thoryn examples run` can sign in immediately without an email
   round-trip. See the **open item** below.
4. **A read-back check** (`applications.get`) — asserts the client is `active`.

## The relying party (`apps/loopback-rp/`)

`thoryn examples run sandbox-signin` launches the readable, dependency-free Node.js loopback RP in
[`apps/loopback-rp/`](apps/loopback-rp/) (SSO-2880) pointed at the **sandbox environment's issuer** and
the client id from the receipt, so a user completes the full Authorization-Code + PKCE flow to a
protected page. You can also run it by hand — see [`apps/loopback-rp/README.md`](apps/loopback-rp/README.md).

## How the interpreter authenticates

This recipe has **no `hub.createWorkspace` step**, so the interpreter authenticates the `env.create` /
`applications.create` / `identity.registerUser` / `.get` / `.delete` calls with **the caller's own
tenant-scoped bearer** directly. The API key is already `tnt`-scoped to the standing workspace; the
sandbox is created under it, and the client + user are created into the sandbox via the
`X-Thoryn-Environment` header the interpreter sets automatically.

## Parameters

| Param           | Required | Meaning                                                                 |
|-----------------|----------|-------------------------------------------------------------------------|
| `workspaceSlug` | **yes**  | The slug of the **standing** workspace your API key is scoped to (NOT created). CI passes `--set workspaceSlug=<slug>`; the guided `apply` prompts for it. |
| `envSlug`       | no       | Slug for the fresh sandbox environment. Defaults to `sbx-signin-<random>` so each run is unique. |
| `envName`       | no       | Display name for the sandbox environment. Defaults to `Sandbox Sign-in`. |
| `appName`       | no       | Display name for the ephemeral client. Defaults to `Sandbox Sign-in App <random>`. |

## Teardown (child-first, always)

Teardown runs in declared order:

1. **`applications.delete`** — remove the client (`{{app.clientId}}`).
2. **`env.delete`** — hard-delete the sandbox (`{{env.id}}`), product-api
   `DELETE /api/v1/environments/{id}` (`tenant:environments.write`).

`env.delete` is **sandbox-only** — it refuses the production plane (`409
cannot_delete_production_environment`). The **confirmation slug** the interpreter sends as the
`X-Thoryn-Confirm` header is the environment's **own slug**, which it resolves from the run state it
recorded at `env.create` (a missing header is `428`, a mismatched one `422`). You therefore do **not**
template the slug in this recipe — only the env id (`{{env.id}}`) is referenced. Hard-deleting the
sandbox cascades the client (and the user provisioned into it), so the `applications.delete` step is
belt-and-braces; both are best-effort, so a failed run still cleans up.

## Requires

`tenant:environments.write` (create + delete the sandbox), `tenant:applications.write` (create/delete
the client), `tenant:applications.read` (the post-create `applications.get` verify), and
`tenant:users.write` (register the sign-in-able user). The connection-contract's tenant-scoped machine
client already holds the first three; the CI provisioning key adds `tenant:users.write` (see the repo
[`README.md`](../../README.md) "CI provisioning setup").

> **CLI version:** this recipe is **fetched from the signed catalog** (`thoryn examples update`), so it
> needs the CLI release that runs non-bundled recipes and carries the `env.create` / `env.delete` /
> `identity.registerUser` recipe actions (`cli-v0.3.7`+). Older `cli-v*` jars won't resolve it.

## Open item the first LIVE run must confirm (SSO-2969)

- **Is `identity.registerUser` per-environment or per-workspace?** The interpreter switches the
  effective environment to the sandbox before the `user` step, so the user *should* be created inside
  the sandbox and be sign-in-able against the sandbox's per-env issuer. But the identity/user surface
  may not yet honour `X-Thoryn-Environment`. If the first `sandbox-e2e` live run shows the user landing
  at the workspace scope (or not sign-in-able against the sandbox issuer), that is a **product gap to
  record** (SSO-2943 family) — not a shortcut to work around in the recipe.
- **The sandbox environment's per-env issuer.** The `sandbox-e2e` workflow resolves the issuer the RP
  points at from the run receipt, falling back to deriving it from the sandbox slug. Whether a sandbox
  environment has its **own** issuer subdomain (vs. sharing the workspace issuer with environment
  scoping applied by the header) is unproven — the first live run confirms which.
