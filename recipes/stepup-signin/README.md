# `stepup-signin` — step-up / re-authentication for a sensitive action (OIDC `prompt=login`, RFC 9470)

Provisions a fresh, throwaway **sandbox environment** with a loopback OAuth client and a sign-in-able
user, then drives a real browser to prove a **sensitive action forces a fresh authentication**: after
signing in normally, the relying party starts a second authorization request with the standard OIDC
`prompt=login` parameter, and the user is **challenged to authenticate again** even though the session
is still active. A plain re-authorize (no `prompt=login`) rides the existing session silently — the
control that makes the step-up observable.

This is the third of the MFA / re-authentication examples (epic SSO-3042), alongside
[`totp-signin`](../totp-signin) (a second factor) and [`passkey-signin`](../passkey-signin) (a
passwordless second factor). Where those add a *factor*, this one demonstrates **re-authentication**:
proving it is still you before a high-value operation.

> **v2 (SSO-3091/3092, epic SSO-3087):** the recipe is now ONLY the client, applied into the environment
> you select (`--environment <sandbox-slug>`). The throwaway sandbox and the sign-in-able user the browser
> scenario needs are FIXTURES in [`e2e/provision.yaml`](e2e/provision.yaml). Steps about `env.create` /
> `identity.registerUser` below describe v1.

## What it demonstrates

- **Step-up is a standard OIDC request, not a product setting.** The relying party asks for a fresh
  login with `prompt=login` (RFC 9470 “step up authentication”). No tenant/app configuration, no
  step-up-specific scope, and no new recipe action — the whole behaviour is the RP's authorize request
  plus the hub honouring it.
- **The hub re-drives the hosted login end to end** (SSO-3071): `prompt=login` is carried onto the
  identity federation login so the user re-authenticates at the real hosted form, rather than the hub
  silently reusing its session.
- **Everything runs in a per-run sandbox** and is hard-deleted on teardown.

## The journey (`e2e/stepup-signin-journey.spec.ts`)

1. Sign in normally → the RP protected page (an active session now exists).
2. Click **“Perform a sensitive action”** — the RP's `/step-up` route starts an authorize with
   `prompt=login`. Even with an active session, the hosted login form (`#passwordForm`) reappears.
3. Re-authenticate → back on the protected page, with an `auth_time` not older than the first sign-in.

**Error path:** the step-up genuinely re-verifies credentials — a wrong password at the re-auth is
rejected and the sensitive action does not complete.

> **Sandbox note.** Examples run in an isolated sandbox environment, and the hub additionally pushes
> `prompt=login` on *every* sandbox authorize for isolation (SSO-2981). It is the relying party's own
> `prompt=login` — the pattern this recipe demonstrates — that turns an otherwise-silent re-authorize
> into a fresh challenge on the production / customer plane (made to work end to end by SSO-3071).

## Endpoint reference

| Method | Path (relying party) | Description |
|---|---|---|
| GET | `/login` | Begin an ordinary authorization-code + PKCE sign-in. |
| GET | `/step-up` | A **sensitive action** — begins an authorize with `prompt=login` (force re-auth). |
| GET | `/callback` | OAuth redirect target; exchanges the code and starts a session. |
| GET | `/protected` | Renders only for a signed-in session; links to the sensitive action. |

The step-up itself is the standard OIDC authorize parameter `prompt=login` on the hub's
`/oauth2/authorize`.

## Run it

```
thoryn examples apply stepup-signin
```

Provisions the sandbox + client + user, prints the connection details, and (via the colocated E2E in
CI) exercises the browser journey. Teardown hard-deletes the sandbox.

## Security notes

- `prompt=login` is the OIDC-standard way for a relying party to require a fresh authentication for a
  sensitive operation; the hub also honours `max_age` for time-bounded freshness (see the platform
  docs — `max_age`-forced re-auth at the hub is tracked separately).
- The example credential is published — rotate before any real use.
