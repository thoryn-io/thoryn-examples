# `magic-code-signin` — passwordless sign-in with a 6-digit email OTP

Provisions a fresh, throwaway **sandbox environment** with a loopback OAuth client and a sign-in-able
user, then drives a real browser to sign in with **no password**: the user requests a 6-digit code on
the hosted login, the code is captured from the sandbox test-inbox, typed back on the login page, and
the OAuth flow resumes to the relying party's protected page.

This is the OTP sibling of [`magic-link-signin`](../magic-link-signin) (email *link*) — same
passwordless idea, a short numeric code the user types instead of a link they click.

## Opt-in (unlike magic-link)

Magic-code is **not** in the default login-method set, so the journey first **enables it for the
sandbox**:

```
thoryn login-methods set --environment <sandbox-slug> \
  --method password --method magic_link --method magic_code
```

`--environment` targets the sandbox (rides `X-Thoryn-Environment`), and per-environment enforcement
means the sandbox login offers magic-code **without touching production**. This is a supported CLI
action — an example never reaches for a raw API call.

## The journey (`e2e/magic-code-signin-journey.spec.ts`)

1. Enable magic-code for the sandbox (`thoryn login-methods set`).
2. On the hosted login, click **“Email me a code”**, enter the email, submit.
3. Capture the 6-digit code from the sandbox test-inbox (`thoryn env test-emails --channel magic_code`).
4. Type the code → passwordless sign-in reaches the RP protected page.

**Error path:** a wrong 6-digit code is rejected at the hosted challenge.

## Endpoint reference

| Method | Path | Description |
|---|---|---|
| POST | `/auth/magic-code/request` | Email a single-use 6-digit code (JSON `{email, clientId, redirectUri}`). |
| POST | `/auth/magic-code/verify` | Verify the code (form `email` + `code`) → resume `/oauth2/authorize`. |

## Run it

```
thoryn examples apply magic-code-signin
```

Provisions the sandbox + client + user; the colocated E2E enables magic-code and exercises the
passwordless journey. Teardown hard-deletes the sandbox (client + user + login-method policy).

## Security notes

- The code is **6 digits, single-use, 10-minute TTL, attempt-capped**, stored only as a bcrypt hash
  (never plaintext). In a sandbox the code email is suppressed from real SMTP and captured to the
  per-env test-inbox for the example to read — it is never sent to a real recipient.
- The example credential is published — rotate before any real use.
