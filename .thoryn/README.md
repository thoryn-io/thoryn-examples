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

**"What I own" is per scenario, not per repo.** Each browser scenario declares its own fixtures —
a throwaway sandbox environment (and, where the journey needs one, a test user or an email sink) — in
`recipes/<id>/e2e/provision.yaml`, converged by `thoryn provision apply` and removed by
`thoryn provision destroy` at the end of the run. The recipe (`recipes/<id>/recipe.yaml`) is what a
**customer** applies; the fixtures around it are visibly test scaffolding. See
[`e2e/README.md`](../e2e/README.md).

## One-time bootstrap (operator, run once)

The machine client this contract names does not exist until an operator mints it once, through the
customer plane — no DB seed, no shortcut:

1. Sign in to the `examples` workspace interactively (browser OIDC):
   `thoryn login --issuer https://hub.stg.thoryn.org` then `thoryn workspace switch examples`.
2. Mint a confidential `client_credentials` client granting exactly the scopes listed in
   `connection.json` — the full CI set (environments + applications + users + email + idp, read and
   write): sandbox-signin needs environments/applications, simple-signin adds users (suspend case) and
   email (the Mailpit sink fixture), branded-signin adds idp (the login theme). The hub answers
   `invalid_scope` to a client-credentials request that exceeds the client's grant, so the client's
   grant (`thoryn clients get <id>`) must always be a superset of this list. Your own session must hold
   every scope you delegate, so sign in with them (`thoryn login --issuer … --scope "openid offline_access tenant:…"`);
   `--redirect-uri` is required by `clients create` even for a client-credentials client (never used):
   ```bash
   thoryn clients create --display-name "thoryn-examples CI" \
     --client-type confidential --grant-type client_credentials --redirect-uri http://127.0.0.1/unused \
     --scope tenant:environments.write --scope tenant:environments.read \
     --scope tenant:applications.write --scope tenant:applications.read \
     --scope tenant:users.write --scope tenant:users.read \
     --scope tenant:email.write --scope tenant:email.read \
     --scope tenant:idp.write --scope tenant:idp.read \
     --secret-file ci.secret --output json
   ```
   (the secret lands only in `ci.secret`, via the CLI's `SecretIo` channel — never stdout/argv).
3. **Paste the printed `clientId`** into `auth.clientId` (it ships as `REPLACE_AFTER_BOOTSTRAP`) and commit.
4. **Set the GitHub Actions secret** `THORYN_EXAMPLES_CI_CLIENT_SECRET` to the contents of `ci.secret`,
   then `shred ci.secret`.

The legacy `THORYN_API_KEY` (`<client-id>:<client-secret>`) secret and the imperative
`login --client-credentials` block it fed are retired workflow by workflow as each scenario moves to
the contract (SSO-3091); delete the secret once the last one has.

## Confinement

The credential is confined three ways, all server-side: the client's `tnt` claim locks it to the
`examples` workspace (cross-tenant → 404); the hub mints only the requested scopes; and both the
provisioning file's `kind` allowlist and the recipe's `action` allowlist bound what a run can express.
Rotate the secret with `thoryn clients rotate-secret` (24h graceful overlap).
