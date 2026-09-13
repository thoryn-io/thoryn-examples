// SSO-3045 (epic SSO-3042) — declared scenario metadata for the `passkey-signin` colocated E2E.
// ONE source of truth for the journey's step titles (imported by the spec + the results reporter).

export const STEPS = {
  firstSignin:
    "Password sign-in (no passkey yet) reaches the RP protected page",
  enroll:
    "Enrol a WebAuthn passkey via a CDP virtual authenticator (real register ceremony)",
  enforce:
    "Activate a `password + REQUIRED passkey` login flow for the sandbox (thoryn login-flow)",
  challenge:
    "Fresh sign-in is CHALLENGED for the passkey second factor → assertion → /protected",
};

export const scenario = {
  id: "passkey-signin",
  workflow: ".github/workflows/passkey-signin-e2e.yml",
  title: "Passwordless second factor (passkey/WebAuthn): enrol a passkey, then sign-in is challenged for it",
  summary:
    "Drives the `passkey-signin` recipe's loopback relying party against the staging SaaS in a real " +
    "browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create). A verified user signs in " +
    "with a password, ENROLS a WebAuthn passkey via the product's self-service passkey ceremony — a " +
    "GENUINE navigator.credentials.create round-trip answered by a Playwright CDP virtual authenticator " +
    "(never faked) — then the journey activates a `password REQUIRED + passkey REQUIRED` login flow for " +
    "the sandbox with `thoryn login-flow set --activate` (SSO-3065). A fresh sign-in is then CHALLENGED " +
    "at the hosted /mfa/passkey/challenge screen; the virtual authenticator produces the assertion, the " +
    "server accepts it, and the OAuth flow resumes to the RP protected page. An assertion from an EMPTY " +
    "authenticator is rejected. The whole sandbox (client + user + passkey + login flow) is hard-deleted " +
    "on teardown. Passkey MFA is enforce-driven (unlike TOTP), so the flow is activated after enrol.",
  steps: [
    { key: "firstSignin", title: STEPS.firstSignin },
    { key: "enroll", title: STEPS.enroll },
    { key: "enforce", title: STEPS.enforce },
    { key: "challenge", title: STEPS.challenge },
  ],
  errorPath: {
    title: "An assertion from an empty authenticator is rejected at the passkey challenge",
  },
  // FIRST-LIVE-CONFIRM seams (validated on the first live run, like the original sandbox-signin).
  liveConfirm: [
    "The self-service passkey register ceremony (POST /passkeys/register/begin+complete) is reachable as the signed-in sandbox user on the identity origin (SSO-3063 resolves the user by principal).",
    "The WebAuthn rpId matches the served identity host (SSO-3064) so navigator.credentials.create/get do not SecurityError.",
    "`thoryn login-flow set --stage password:PASSWORD:REQUIRED --stage passkey:PASSKEY:REQUIRED --activate` activates the flow for the selected sandbox env (SSO-3065; env selected via `thoryn env use`).",
    "A passkey-enrolled user under that flow is challenged at /mfa/passkey/challenge on a fresh sign-in and the assertion resumes to the RP.",
  ],
};
