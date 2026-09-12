// SSO-3043 (epic SSO-3042) — declared scenario metadata for the `totp-signin` colocated E2E.
// ONE source of truth for the journey's step titles (imported by the spec + the results reporter).

export const STEPS = {
  firstSignin:
    "Password sign-in (no second factor yet) reaches the RP protected page",
  enroll:
    "Enrol a TOTP authenticator via the self-service MFA API and verify a computed code",
  challenge:
    "Fresh sign-in is CHALLENGED for the second factor → computed TOTP → /protected",
};

export const scenario = {
  id: "totp-signin",
  workflow: ".github/workflows/totp-signin-e2e.yml",
  title: "Two-factor (TOTP): enrol an authenticator, then sign-in is challenged for the code",
  summary:
    "Drives the `totp-signin` recipe's loopback relying party against the staging SaaS in a real " +
    "browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create). A verified user signs in " +
    "with a password, ENROLS a TOTP authenticator via the product's self-service MFA API, then a fresh " +
    "sign-in is CHALLENGED at the hosted /mfa/totp/challenge screen — answered with a code computed " +
    "locally by the pure RFC-6238 computer (e2e/lib/totp.mjs), the same algorithm a real authenticator " +
    "app runs. A wrong code is rejected. The whole sandbox (client + user + MFA enrolment) is " +
    "hard-deleted on teardown. MFA is user-enrolment-driven, so no MFA-specific recipe action is needed.",
  steps: [
    { key: "firstSignin", title: STEPS.firstSignin },
    { key: "enroll", title: STEPS.enroll },
    { key: "challenge", title: STEPS.challenge },
  ],
  errorPath: {
    title: "A wrong TOTP code is rejected at the second-factor challenge",
  },
  // FIRST-LIVE-CONFIRM seams (validated on the first live run, like the original sandbox-signin).
  liveConfirm: [
    "The self-service MFA enrol API (POST /api/v1/me/mfa/totp/enrol → {secret}) is reachable as the signed-in user on the identity origin (XSRF double-submit handled).",
    "A TOTP-enrolled user is challenged at /mfa/totp/challenge (#mfa-form / #code) on a fresh sign-in.",
    "The locally computed RFC-6238 code completes the challenge; a wrong code surfaces #error-message.",
  ],
};
