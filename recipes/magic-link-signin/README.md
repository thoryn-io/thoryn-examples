# `totp-signin` example (ephemeral sandbox + a TOTP second factor)

A declarative Thoryn example recipe that does everything [`sandbox-signin`](../sandbox-signin/README.md)
does — provision a throwaway **sandbox environment** + a loopback OAuth client + a sign-in-able user —
and adds the canonical **two-factor** concept: the browser journey **enrols a TOTP authenticator** for
the user, then proves a fresh sign-in is **challenged for the second factor** and completes with a
computed code.

> MFA in Thoryn is **user-enrolment-driven** — once a user enrols a second factor, every sign-in
> challenges for it. So this recipe provisions the same shape as `sandbox-signin` (no MFA-specific
> action or scope); the 2FA behaviour lives entirely in the journey.

## Run it

```bash
thoryn examples update
thoryn examples setup    totp-signin --set workspaceSlug=<your-ws>   # sandbox + client + user
thoryn examples run      totp-signin                                 # browser: sign in → (enrol) → TOTP challenge → /protected
thoryn examples teardown totp-signin                                 # delete the client + hard-delete the sandbox
```

## The journey (browser E2E)

`recipes/totp-signin/e2e/totp-signin-journey.spec.ts` (workflow `.github/workflows/totp-signin-e2e.yml`):

1. **Password sign-in** — the user signs in with just the password (no second factor yet) → `/protected`.
2. **Enrol TOTP** — as the signed-in user, call the self-service MFA API (`POST /api/v1/me/mfa/totp/enroll` → `{secret}`) and verify a code computed by the pure RFC-6238 computer in [`e2e/lib/totp.mjs`](../../e2e/lib/totp.mjs) — the same algorithm a real authenticator app runs (never faked).
3. **Challenge** — a fresh sign-in is now **challenged** at the hosted `/mfa/totp/challenge`; the computed code completes it → `/protected`. A wrong code is rejected.

The whole sandbox (client + user + MFA enrolment) is hard-deleted on teardown. Per-run results land in [`E2E_RESULTS.md`](E2E_RESULTS.md).

## Scopes

`tenant:environments.write` (create/delete the sandbox), `tenant:applications.write` + `.read`
(create/verify/delete the client), `tenant:users.write` (register the user). No MFA-specific scope —
TOTP enrolment is a user self-service action the journey performs as the signed-in user.
