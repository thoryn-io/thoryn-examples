# `.thoryn/` — this repo's as-code binding to Thoryn (SSO-3091, epic SSO-3087)

`connection.json` is the **connection contract** (schema: `connection.schema.json` in
[`thoryn-io/thoryn-cli`](https://github.com/thoryn-io/thoryn-cli), SSO-2948) that binds **this repo's
CI** to the standing `examples` workspace — "who I am". The scenario workflows sign in with one
declarative step, run by the reusable provisioning Action from `thoryn-cli`:

```bash
thoryn login --connection .thoryn/connection.json
```

The CLI derives the per-tenant issuer (`https://examples.hub.<env>`), the gateway and the requested
scopes **from this file**. It is data, not code: the secret is NEVER here, only the *name* of the env
var that carries it (`auth.secretEnv` = `THORYN_EXAMPLES_CI_CLIENT_SECRET`).

**"What I own" is per example, and it is the example's own file.** Each example's
`recipes/<id>/provision.yaml` is how to get Thoryn up and running for it (sandbox, loopback client, demo
user, sign-in methods, look-and-feel) — the same file a customer copies into their own `.thoryn/`. The
recipe (`recipes/<id>/recipe.yaml`) references it and adds only the extra steps beyond the provisioning;
`thoryn examples apply` converges the provision file first, and `examples teardown` destroys it. CI applies
exactly what a customer applies. See [`e2e/README.md`](../e2e/README.md).

## The least-privilege CI identity `examples-ci` (SSO-3113, epic SSO-3108)

`provision.yaml` (this folder) is the repository's **workspace-level** "what I own" file. It declares only
what CI stands on — never an example's own resources:

| Resource | What it is |
|---|---|
| `application/examples-ci` | the CI machine identity: confidential, `client_credentials` only, fixed `clientId: examples-ci`, on the `examples` workspace's production plane |
| `environment/<recipe-id>` × 8 | one **long-lived fixture sandbox** per sandbox-plane recipe, slug `ci-<recipe-id>`, each with `grants: [{subject: "client:examples-ci", relation: manager}]` |

It replaces `app-9450eb88-c1f`, the client minted by hand under the old bootstrap (SSO-3091), whose ten
workspace-wide scopes reached every environment and the production plane of the workspace.

### Why the sandboxes are fixtures, not per-run throwaways

Settled by the product owner on 2026-09-16. To create a resource you need `manager` on its **parent**, and
the parent of an environment is the **workspace**. A confined identity is `manager` of specific sandboxes,
not of the workspace, so it **cannot create an environment**. Making CI a workspace manager was rejected:
it would give CI back the reach epic SSO-3108 removed. So:

- a founder creates the fixture sandboxes **once**, by applying this file;
- CI **adopts** them (`thoryn examples apply <id> --set envSlug=ci-<id>`): the recipe's `environment`
  resource matches the fixture by slug, and adopted resources are never deleted by `teardown`;
- CI **creates and destroys only what lives inside** a sandbox (the loopback client, the demo user, the
  sign-in methods / theme). Being `manager` of the sandbox lets it manage everything inside it.

There is one sandbox per recipe, never a shared one. Per-environment settings (login flow, sign-in
methods, theme) would otherwise carry over from one scenario to the next (the SSO-3076 bug). Runs never
overlap: every scenario workflow and `conformance.yml` share the `example-e2e` concurrency group. Each
fixture's `displayName` matches its recipe's, so adopting it changes nothing.

### Scopes — exactly what converging CI's files needs

| Scope | Why |
|---|---|
| `tenant:environments.read` | `environment` kind (adopt the fixture) + `env test-emails` (sandbox test-inbox capture in journeys) |
| `tenant:environments.write` | `environment` kind (converge the adopted fixture's shape) |
| `tenant:applications.read` / `.write` | `application` kind: the loopback RP inside the sandbox; the identity's own record |
| `tenant:users.read` / `.write` | `user` kind: the demo account |
| `tenant:idp.read` / `.write` | `loginTheme` / `loginMethods` kinds + `login-methods set` / `login-flow set` in the magic-code / passkey journeys |
| `tenant:access.read` / `.write` | the `grants:` blocks in this file (read to diff, write to converge) |

**Not held:** `tenant:email.*` (only simple-signin's production-plane BYO-SMTP needs it) and
`tenant:federation.*` (no recipe declares a federation member). **Scopes are the ceiling, the grant is
the gate** (ADR `2026-09-15-platform-resource-authorization-on-fga.md` §4): a call on an object
`examples-ci` does not manage answers `404` whatever scopes the token carries.

`tests/test_examples_ci_identity.py` (CI job *CI identity is least-privilege*) recomputes the scope set
from the kinds in this file and in the confined recipes' provision files, plus the CLI actions their
journeys run, and fails on any difference. It also checks that the identity's only reach is `manager` on
exactly one fixture per confined recipe, that no recipe file grants anything, and that every recipe is
either confined or listed as *not confined* with a reason. Once `connection.json` names `examples-ci`, it
also checks that `connection.json` requests no scope beyond the ones declared here.

### Not confined: `simple-signin`

simple-signin exercises the **production plane**: a production-plane client and demo user, the
workspace's BYO-SMTP email provider (`workspace email-provider set`/`reset`, for a real verification
email into the in-job Mailpit), and a user suspend. Creating on the production plane needs `manager` on
the workspace, so a sandbox-confined identity cannot run it. It stays off `examples-ci`. The options are
listed on SSO-3131 (follow-up of SSO-3113).

### Founder bootstrap (run once, cli-v0.15.0 or newer)

```bash
# 1. Sign in to the examples workspace as a workspace admin, requesting every scope the file grants.
#    The hub only lets you grant scopes your own session holds (SSO-1028's intersection rule).
#    `thoryn-cli` is the platform login client homed at the default tenant; it resolves cross-tenant, so
#    `--workspace examples` signs you straight into `examples`. No `workspace switch` is needed (it was
#    broken until SSO-3121).
thoryn login --workspace examples --issuer https://hub.stg.thoryn.org --client-id thoryn-cli \
  --scope "openid offline_access tenant:environments.read tenant:environments.write tenant:applications.read tenant:applications.write tenant:users.read tenant:users.write tenant:idp.read tenant:idp.write tenant:access.read tenant:access.write"

# 2. Converge the file: creates examples-ci (its ONE-TIME secret goes only to ./examples-ci.secret, via
#    SecretIo: never stdout, argv or the receipt), the 8 fixture sandboxes, and their grants
#    (converged in a second pass, after every resource exists).
thoryn provision plan  --file .thoryn/provision.yaml
thoryn provision apply --file .thoryn/provision.yaml --secret-file ./examples-ci.secret

# 3. Hand the secret to CI and destroy the local copy.
gh secret set THORYN_EXAMPLES_CI_CLIENT_SECRET --repo thoryn-io/thoryn-examples < ./examples-ci.secret && rm -f ./examples-ci.secret
```

`*.secret` and `.thoryn/*.receipt.json` are git-ignored. After this, the step-2 PR switches
`connection.json` to `examples-ci`. Every later `apply` of this file **adopts** `examples-ci` by its
fixed id, so CI can never delete the identity it signs in with. Rotate the secret with
`thoryn clients rotate-secret` (24h graceful overlap).

> **Setting the secret replaces the legacy client's secret.** CI keeps signing in as `app-9450eb88-c1f`
> until the step-2 PR merges. Run step 3 immediately before merging it, or scenario runs in between fail
> at sign-in.

## Confinement

The credential is confined four ways, all server-side: the client's `tnt` claim locks it to the
`examples` workspace (cross-tenant → 404); the hub mints only the requested scopes; the provisioning
file's `kind` allowlist and the recipe's `action` allowlist bound what a run can express; and (the layer
epic SSO-3108 adds) `examples-ci` is `manager` of its fixture sandboxes only, so product-api answers 404
to anything else.
