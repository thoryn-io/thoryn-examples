# `magic-link-cross-device-signin` — passwordless sign-in across two devices

The **anti-phishing** passwordless example. A user starts signing in on one device (say a laptop),
requests an email sign-in link, then opens that link on **another** device (say a phone). Opening the
link on the other device does **not** sign anyone in — it shows a short **continuation code** that
must be typed back on the device that *started* the sign-in. Only then does the sign-in complete, on
the original device.

This is the security story behind magic links: a link that is forwarded, prefetched by a mail
scanner, or intercepted **cannot by itself** complete the sign-in — the code closes that hole
(Thoryn's adaptive cross-device magic-link, SSO-2613).

> The simpler "open the link on the same device and you're straight in" flow is the separate
> [`magic-link-signin`](../magic-link-signin/) example.

## Why no "enable magic link" step

Magic-link is **on by default** in Thoryn's hosted login, so a fresh sandbox already offers it. The
recipe is just `env.create → applications.create → identity.registerUser` (the `sandbox-signin`
shape); the cross-device request / consume / redeem live entirely in the browser journey. No
login-method policy change and no new scope are required.

## Run it

```bash
thoryn examples run magic-link-cross-device-signin
```

## How the cross-device sign-in works

1. **Device A** sends you to the hosted login; you choose **"Sign in with magic link"** and enter
   your email. identity emails a single-use link and sets an `ML_INIT` cookie on **A**.
2. **Device B** opens the link. Because B has no matching `ML_INIT` cookie, identity detects a
   **different device** and does **not** sign B in — it shows a short continuation code.
3. You type that code back on **Device A** (bound to A by `ML_INIT`). identity completes the sign-in
   on A and resumes `/oauth2/authorize` → back to the app, signed in **on A**.

In a **sandbox** the email is captured into the environment's test inbox (`thoryn env test-emails`),
which is how the E2E retrieves the link.

## Endpoint reference

| Method | Path | Description |
|---|---|---|
| POST | `/auth/magic-link/request` | Request a single-use sign-in link (sets `ML_INIT` on the initiating device) |
| GET  | `/auth/magic-link/consume?token=…` | Open the link; on a different device → shows a continuation code (no session) |
| POST | `/auth/magic-link/cross-device/redeem` | Redeem the code on the initiating device → completes the sign-in |

## Security notes

- The clicking device is **never** authenticated cross-device; only the initiating device completes
  the sign-in, and only with the continuation code.
- The continuation code is short-lived (~10 min), single-use, attempt-capped, and bound to the
  initiating session's `ML_INIT` (only its hash is stored).
- The link itself remains single-use and bound to the `(client_id, redirect_uri)` of the sign-in.

## E2E

See [`E2E_RESULTS.md`](./E2E_RESULTS.md) (generated from the live run). Dispatch the
`magic-link-cross-device-e2e` workflow to run it against staging.
