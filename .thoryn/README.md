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
var that carries it (`auth.secretEnv` = `THORYN_EXAMPLES_CONFINED_CI_CLIENT_SECRET`, the one-time secret the founder
apply of `provision.yaml` delivers for `examples-ci` — SSO-3113 step 2).

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
| `environment/<recipe-id>` × 9 | one **long-lived fixture sandbox** per recipe (all 9, `simple-signin` included), slug `ci-<recipe-id>`, each with `grants: [{subject: "client:examples-ci", relation: manager}]` |

It replaced `app-9450eb88-c1f`, the client minted by hand under the old bootstrap (SSO-3091), whose ten
workspace-wide scopes reached every environment and the production plane of the workspace. That legacy
identity is **retired**: no file in this repo names it any more, and its hub-side record goes with the
`examples` workspace reclaim (SSO-3164 step 3 — the product owner hard-deletes the orphaned workspace and
re-creates it; should the record survive that, `thoryn clients delete app-9450eb88-c1f` finishes the job).
Delete the old repository secret `THORYN_EXAMPLES_CI_CLIENT_SECRET` at the same time — nothing reads it.

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
| `tenant:users.read` / `.write` | `user` kind: the demo account; `users suspend` in simple-signin's suspended-login case (inside `ci-simple-signin`) |
| `tenant:idp.read` / `.write` | `loginTheme` / `loginMethods` kinds + `login-methods set` / `login-flow set` in the magic-code / passkey journeys |
| `tenant:access.read` / `.write` | the `grants:` blocks in this file (read to diff, write to converge) |

**Not held:** `tenant:email.*` and `tenant:federation.*`. No recipe declares an `emailProvider` or a
federation member. Every scenario captures mail from its sandbox's test-inbox (`env test-emails`,
covered by `tenant:environments.read`); `simple-signin` too since SSO-3131. The workspace BYO-SMTP is
production-plane reach this identity must never have. **Scopes are the ceiling, the grant is
the gate** (ADR `2026-09-15-platform-resource-authorization-on-fga.md` §4): a call on an object
`examples-ci` does not manage answers `404` whatever scopes the token carries.

`tests/test_examples_ci_identity.py` (CI job *CI identity is least-privilege*) recomputes the scope set
from the kinds in this file and in every recipe's provision file, plus the CLI actions their journeys
run, and fails on any difference. It also checks that the identity's only reach is `manager` on exactly
one fixture per recipe, and that no recipe file grants anything. Every recipe must run in its fixture
sandbox unless its move is blocked on a recorded product gap (`PENDING_SANDBOX_REWORK`), and only such a
recipe may still drive the workspace email provider. It also binds `connection.json` to this file: it must sign in as
`examples-ci`, name the confined secret, and request exactly the scopes declared here; every workflow that
signs in must inject that secret and only that secret; and every scenario workflow must adopt its
recipe's fixture (`ci-<recipe>`), never a per-run slug.

The live half of the proof is `conformance.yml`'s *Assert the CI identity is confined* step (the sibling
of thoryn-cli's `provision-e2e` step): as `examples-ci`, `thoryn env list` must return exactly the nine
fixture slugs, and — when a dispatch supplies `foreign-environment-id` (an environment a privileged
session has confirmed exists, e.g. the workspace's production environment) — `thoryn env get` of it must
answer 404. By design a foreign and a nonexistent environment are the same 404 from the confined side, so
the id is never guessed. `workspace list` is not asserted: it is an `openid`-gated `/account` surface a
`client_credentials` identity cannot call; the workspace is pinned by the token's `tnt` claim instead.

### `simple-signin`: moved into its fixture (SSO-3131)

Settled 2026-09-17 (SSO-3131): `simple-signin` runs in its own fixture sandbox `ci-simple-signin`, so
**one** confined identity covers all 9 recipes and `app-9450eb88-c1f` could be retired.

The move waited on a product gap, SSO-3135. `simple-signin` used to capture three emails through the
workspace BYO-SMTP → an in-job Mailpit reached over a public TCP tunnel: verification, password reset,
and account unlock. A sandbox suppresses all three; it captured verification (SSO-3026) and password
reset (SSO-3079) to the test-inbox, but not the account-unlock email, so the lockout → unlock case could
not pass in a sandbox. SSO-3135 made the sandbox capture it too (channel `account_unlock`). The journey
now reads all three through `thoryn env test-emails` (`e2e/lib/test-inbox.mjs`), and `example-e2e.yml`
has no Mailpit, no tunnel, no `NGROK_AUTHTOKEN` and no `workspace email-provider set`.
`PENDING_SANDBOX_REWORK` in the conformance test is empty; a recipe without a sandbox now fails both the
test and `conformance.yml`.

### Founder bootstrap (run once, cli-v0.15.0 or newer)

```bash
# 1. Sign in to the examples workspace as a workspace admin, requesting every scope the file grants.
#    The hub only lets you grant scopes your own session holds (SSO-1028's intersection rule).
#    `thoryn-cli` is the platform login client homed at the default tenant; it resolves cross-tenant, so
#    `--workspace examples` signs you straight into `examples`. No `workspace switch` is needed (it was
#    broken until SSO-3121).
# SSO-3296 — `--issuer` names the platform BASE issuer; it becomes https://auth.stg.thoryn.org at
#    the SSO-3297 cutover. The CLI composes `examples.<that host>` from it, reusing its host label.
thoryn login --workspace examples --issuer https://hub.stg.thoryn.org --client-id thoryn-cli \
  --scope "openid offline_access tenant:environments.read tenant:environments.write tenant:applications.read tenant:applications.write tenant:users.read tenant:users.write tenant:idp.read tenant:idp.write tenant:access.read tenant:access.write"

# 2. Converge the file: creates examples-ci (its ONE-TIME secret goes only to ./examples-ci.secret, via
#    SecretIo: never stdout, argv or the receipt), the 9 fixture sandboxes, and their grants
#    (converged in a second pass, after every resource exists).
thoryn provision plan  --file .thoryn/provision.yaml
thoryn provision apply --file .thoryn/provision.yaml --secret-file ./examples-ci.secret

# 3. Hand the secret to CI and destroy the local copy.
gh secret set THORYN_EXAMPLES_CONFINED_CI_CLIENT_SECRET --repo thoryn-io/thoryn-examples < ./examples-ci.secret && rm -f ./examples-ci.secret
```

`*.secret` and `.thoryn/*.receipt.json` are git-ignored. `connection.json` already names `examples-ci`
(SSO-3113 step 2), so CI is live the moment the repository secret exists. Every later `apply` of this
file **adopts** `examples-ci` by its fixed id, so CI can never delete the identity it signs in with.
Rotate the secret with `thoryn clients rotate-secret` (24h graceful overlap) and update the repository
secret.

Order of operations for the `examples` workspace reclaim (SSO-3164): the founder apply above runs on the
**re-created** workspace and is what mints `examples-ci`; the step-2 cut-over PR is mergeable only after
that apply and after `THORYN_EXAMPLES_CONFINED_CI_CLIENT_SECRET` is set from its `--secret-file` output.

## Confinement

The credential is confined four ways, all server-side: the client's `tnt` claim locks it to the
`examples` workspace (cross-tenant → 404); the hub mints only the requested scopes; the provisioning
file's `kind` allowlist and the recipe's `action` allowlist bound what a run can express; and (the layer
epic SSO-3108 adds) `examples-ci` is `manager` of its fixture sandboxes only, so product-api answers 404
to anything else.
