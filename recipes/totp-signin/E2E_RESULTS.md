# totp-signin — E2E results

**Enrol→challenge journey is BLOCKED on [SSO-3049] and currently skipped (`test.describe.fixme`).**

The recipe, the pure RFC-6238 TOTP computer (`e2e/lib/totp.mjs`, unit-tested against the RFC
Appendix-B vectors), and the password first-sign-in are all in place. But a **sandbox-environment
user has no reachable self-service MFA-enrolment path** on staging (proven with Playwright network
traces, 2026-09-12):

- the hub-federated session does **not** authorize identity's account portal
  (`GET /account/security` → 302 `/login` → enrol `POST /mfa/totp/enroll` runs anonymous → 403);
- a **direct** identity `/login` cannot authenticate a sandbox user (no env context → stays on
  `/login`).

So the enrol→challenge steps cannot run end-to-end until SSO-3049 provides a path (e.g. the federated
session authorizing the account portal, or an MFA-enrol product API callable with the user's token).
The journey is kept in the suite as `test.describe.fixme` so it is honestly skipped, not faked or red;
flip it back to `test.describe` once SSO-3049 lands.

[SSO-3049]: https://thoryn.atlassian.net/browse/SSO-3049
