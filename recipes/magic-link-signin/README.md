# `magic-link-signin` — passwordless sign-in via a single-use email link (same device)

The canonical **passwordless** example. A user signs in with **no password**: the hosted login
emails them a single-use sign-in link; opening it **on the same device** that started the sign-in
logs them straight in and resumes the OAuth flow to the app.

It provisions a throwaway **sandbox environment** in your standing workspace, a loopback OAuth
client, and a verified user inside it — then the browser E2E drives the real passwordless journey and
the sandbox is hard-deleted on teardown.

> Opening the link on **another** device is a deliberately different, anti-phishing flow (a short
> continuation code you type back on the first device). That is the separate
> [`magic-link-cross-device-signin`](../magic-link-cross-device-signin/) example.

## Why no "enable magic link" step

Magic-link is **on by default** in Thoryn's hosted login (it is in the default login-method order),
so a fresh sandbox already shows the "email me a sign-in link" affordance. The recipe is just
`env.create → applications.create → identity.registerUser` (the same shape as `sandbox-signin`); the
passwordless request + consume live entirely in the browser journey. No login-method policy change
and no new scope are required.

## Run it

```bash
thoryn examples run magic-link-signin
```

You will be prompted for your standing workspace slug. The recipe creates a fresh sandbox
(`magic-link-{slug8}`), a loopback client, and a verified user, then verifies the client is active.

## How the sign-in works

1. The app sends you to the hosted login; you choose **"Sign in with magic link"** and enter your
   email. identity `POST /auth/magic-link/request` emails a single-use link and sets an `ML_INIT`
   cookie on **this** device.
2. You open the link. Because this device carries the matching `ML_INIT` cookie (**same device**),
   identity authenticates the session and resumes `/oauth2/authorize` → back to the app, signed in.

In a **sandbox** the email is not sent over real SMTP — it is captured into the environment's test
inbox (readable with `thoryn env test-emails`), which is how the E2E retrieves the link.

## Endpoint reference

| Method | Path | Description |
|---|---|---|
| POST | `/auth/magic-link/request` | Request a single-use sign-in link for an email (always 202; sets `ML_INIT`) |
| GET  | `/auth/magic-link/consume?token=…` | Open the link; same device → signed in + resume OAuth |

## Security notes

- The link is **single-use**, short-lived (~15 min), and bound to the `(client_id, redirect_uri)` of
  the sign-in it was requested for.
- The `ML_INIT` cookie is `HttpOnly` / `Secure` / `SameSite=Lax`; only its SHA-256 hash is stored, so
  a database dump cannot forge the initiating device.
- Opening the link on a **different** device never authenticates that device — see the cross-device
  example.

## E2E

See [`E2E_RESULTS.md`](./E2E_RESULTS.md) (generated from the live run). Dispatch the
`magic-link-signin-e2e` workflow to run it against staging.
