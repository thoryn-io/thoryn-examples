# `branded-signin` example (ephemeral sandbox + a **branded** hosted sign-in)

A declarative Thoryn example recipe that does everything [`sandbox-signin`](../sandbox-signin/README.md)
does — provision a throwaway **sandbox environment** in a workspace you already own, a public loopback
OAuth client and a sign-in-able user **in it**, sign in end to end, then hard-delete the sandbox — and
adds **one concept**: it **styles the hosted sign-in screen** so the login your end users see carries
**your brand** (logo, colors, corner radius, light/dark).

> Each example teaches one thing. `sandbox-signin` is the minimal "sign in against an ephemeral
> sandbox" baseline; `branded-signin` is the "…and brand the login screen" example.

The styling uses the **same customer-plane surface the `thoryn branding set` CLI command wraps**
(product-api `PUT /api/v1/login-experience/branding`, SSO-3037) — the recipe is just the declarative
form. identity renders the fields as **CSS custom properties** (`--brand-primary`, `--brand-bg`,
`--brand-radius`) in the hosted login template; the server validates them (hex colors, radius 0–64,
theme enum, https logo URL) and enforces a **WCAG-AA contrast guard**. The branding is **per
environment** — applied to this run's sandbox only, and torn down with it.

## Run it

Needs the `thoryn` CLI **≥ 0.5.0** (the release carrying the `tenant.configureLoginTheme` action). The
recipe is fetched from the signed catalog (`thoryn examples update`) — it is **not** bundled in the CLI.

```bash
thoryn examples update                                                    # refresh the signed catalog
thoryn examples setup    branded-signin --set workspaceSlug=<your-ws>     # sandbox + client + theme + user
thoryn examples run      branded-signin                                   # opens your browser: a BRANDED sign-in → /protected
thoryn examples teardown branded-signin                                   # delete the client + the sandbox (branding included)
```

Override the look from the command line (defaults: `primaryColor=#7c3aed`, `loginTheme=light`):

```bash
thoryn examples setup branded-signin --set workspaceSlug=<your-ws> \
  --set primaryColor=#0ea5e9 --set loginTheme=dark
```

The same thing imperatively, without a recipe, against the selected environment:

```bash
thoryn env use <sandbox-slug>
thoryn branding set --primary-color '#0ea5e9' --theme dark --logo-url https://example.com/logo.svg
thoryn branding get
```

## What it provisions

1. **A fresh sandbox environment** (`env.create`) — the interpreter switches the run's effective
   environment to it, so every later step provisions into this sandbox.
2. **A public loopback OAuth client** (`applications.create`) — authorization-code + PKCE.
3. **A login theme** (`tenant.configureLoginTheme`) — `PUT /api/v1/login-experience/branding`
   (`tenant:idp.write`), scoped to the sandbox env. This is the recipe's headline step.
4. **A verified, sign-in-able user** (`identity.registerUser`).

Teardown deletes the client, then hard-deletes the sandbox — which cascades the client, the user, **and
the branding row**, so nothing branded outlives the environment.

## Verified by the browser E2E

`recipes/branded-signin/e2e/branded-signin-journey.spec.ts` (workflow
`.github/workflows/branded-signin-e2e.yml`) drives the real loopback RP against staging and **asserts
the rendered hosted login carries the configured brand** — the `--brand-primary` CSS custom property
equals the recipe's `primaryColor`. The verification email is read from the sandbox **test inbox**
(`thoryn env test-emails`, SSO-3026), because a sandbox suppresses real transactional email by design.
Per-run results land in [`E2E_RESULTS.md`](E2E_RESULTS.md).

## Scopes

`tenant:environments.write` (create/delete the sandbox), `tenant:applications.write` +
`tenant:applications.read` (create/verify/delete the client), `tenant:users.write` (register the user),
and `tenant:idp.write` (style the login). A tenant-scoped `client_credentials` key that holds these can
run the whole recipe — no workspace-create scope needed (the SSO-2943 gap the sandbox model sidesteps).
