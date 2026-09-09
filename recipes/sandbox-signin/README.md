# `sandbox-signin` example (per-run ephemeral sandbox)

A declarative Thoryn example recipe that gives every run its **own isolation** by provisioning a
throwaway **sandbox environment** inside a workspace you already own, provisioning a public loopback
OAuth client **into that sandbox**, and hard-deleting **both** on teardown — using only supported
product workflows (recipes are data, not code; the CLI is the only executor, dispatching on a closed
action allowlist).

It is the **per-example-isolation sibling** of `ci-signin`. Where `ci-signin` creates only an OAuth
client directly in the standing workspace, `sandbox-signin` first creates a **fresh sandbox
environment** and provisions the client into it, so two runs never share environment-scoped state.
It exists for one reason:

> A customer-plane `client_credentials` API key is **tenant-scoped** — bound to one workspace via its
> `tnt` claim — and **cannot create workspaces** (workspace-create needs a machine scope a tenant
> admin cannot delegate; see SSO-2943). But it **can** create and delete **sandbox environments**
> inside its own workspace (`tenant:environments.write`). So per-example isolation is achieved with a
> per-run sandbox rather than a per-run workspace — no new tenant, no new credential, no new trust.

## What it provisions

1. **A fresh sandbox environment** (`env.create`) — product-api `POST /api/v1/environments`
   (`tenant:environments.write`). The interpreter records its id/slug and switches the run's
   **effective environment** to the new slug, so every later step provisions into this sandbox.
2. **A public loopback OAuth client** (`applications.create`) — authorization-code + PKCE, redirecting
   to `http://127.0.0.1/callback`, with an OIDC RP-Initiated-Logout post-logout redirect URI —
   created **inside the sandbox** from step 1.
3. **A read-back check** (`applications.get`) — asserts the client is `active`.

## How the interpreter authenticates

This recipe has **no `hub.createWorkspace` step**, so the interpreter authenticates the `env.create` /
`applications.create` / `.get` / `.delete` calls with **the caller's own tenant-scoped bearer**
directly. The API key is already `tnt`-scoped to the standing workspace; the sandbox is created under
it, and the client is created into the sandbox via the `X-Thoryn-Environment` header the interpreter
sets automatically.

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
sandbox cascades the client, so the `applications.delete` step is belt-and-braces; both are
best-effort, so a failed run still cleans up.

## Requires

`tenant:environments.write` (create + delete the sandbox), `tenant:applications.write` (create/delete
the client), `tenant:applications.read` (the post-create `applications.get` verify). All three are
already held by the connection contract's tenant-scoped machine client.

> **CLI version:** the `env.create` / `env.delete` recipe actions require the thoryn CLI that ships
> them (`cli-v0.3.5`+). Runs that download an older `cli-v*` jar will reject the `env.*` actions.
