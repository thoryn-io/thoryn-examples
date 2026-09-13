# `passkey-signin` — passwordless second factor (WebAuthn passkey)

The phishing-resistant MFA example. A verified user in a fresh, throwaway **sandbox** enrols a
**WebAuthn passkey**, and a subsequent sign-in is **challenged for that passkey** — the real
`/mfa/passkey/challenge` ceremony, end to end — before the OAuth flow resumes to the app.

It builds on [`sandbox-signin`](../sandbox-signin/) (per-run sandbox + loopback OAuth client + a
sign-in-able user) and adds one concept: a passkey second factor.

## Why this recipe activates a login flow (unlike `totp-signin`)

MFA in Thoryn is enrolment-driven **for TOTP/SMS** — enrol it and every sign-in is challenged. A
**passkey is different**: it is challenged only when an **enforce-mode login flow** has a `REQUIRED`
`PASSKEY` stage the user can satisfy. So the journey, after enrolling the passkey, activates a
`password REQUIRED + passkey REQUIRED` flow for the sandbox with the CLI:

```bash
thoryn env use <sandbox-env-slug>
thoryn login-flow set --stage password:PASSWORD:REQUIRED --stage passkey:PASSKEY:REQUIRED --activate
```

Enrol must precede enforce: the self-service passkey enrol is session-gated, so the user first signs
in with the password (the sandbox default flow), enrols the passkey, and only then is the
passkey-enforcing flow activated.

## The journey (`e2e/passkey-signin-journey.spec.ts`)

1. **Password sign-in** (no passkey yet) reaches the RP `/protected` page.
2. **Enrol a passkey** — a genuine `navigator.credentials.create` ceremony on `/passkeys/register`,
   answered by a Playwright **CDP virtual authenticator** (never faked).
3. **Enforce** — activate the `password + passkey` login flow for the sandbox (`thoryn login-flow`).
4. **Challenge** — a fresh sign-in lands on `/mfa/passkey/challenge`; the virtual authenticator
   produces the assertion, the server accepts it, and the OAuth flow resumes to `/protected`.

An error path proves an assertion from an **empty** authenticator is rejected (the accept path is not
a rubber stamp).

The whole sandbox — client, user, passkey credential, and the activated login flow — is
**hard-deleted on teardown**; nothing outlives the environment.

## Requirements

- CLI **≥ 0.7.0** (ships `thoryn login-flow`, SSO-3065).
- Scopes: `tenant:environments.write`, `tenant:applications.write/read`, `tenant:users.write`,
  and `tenant:idp.write` (the login-flow enforce). Request them with
  `thoryn login --scope all-tenant-config`.

## Run it

The CI workflow (`.github/workflows/passkey-signin-e2e.yml`, `workflow_dispatch`) provisions the
sandbox via `thoryn examples apply passkey-signin`, starts the loopback RP, and runs
`npm run test:passkey` against staging.
