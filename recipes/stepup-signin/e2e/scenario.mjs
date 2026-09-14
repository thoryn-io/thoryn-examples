// SSO-3044 (epic SSO-3042) — declared scenario metadata for the `stepup-signin` colocated E2E.
// ONE source of truth for the journey's step titles (imported by the spec + the results reporter).

export const STEPS = {
  firstSignin:
    "Sign in normally — the user now has an active session at the hub",
  stepUp:
    "Sensitive action (OIDC prompt=login) RE-CHALLENGES the active session at the hosted login form",
  reauth:
    "Re-authenticate → the sensitive action completes on the RP protected page (fresh auth_time)",
};

export const scenario = {
  id: "stepup-signin",
  workflow: ".github/workflows/stepup-signin-e2e.yml",
  title: "Step-up / re-authentication: a sensitive action forces a fresh login (OIDC prompt=login, RFC 9470)",
  summary:
    "Drives the `stepup-signin` recipe's loopback relying party against the staging SaaS in a real " +
    "browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create). A verified user signs in " +
    "normally, then the relying party performs a SENSITIVE ACTION by starting a second authorize with " +
    "the standard OIDC `prompt=login` parameter (RFC 9470 step-up). Even though the session is still " +
    "active, the hub re-drives the hosted login and the user is CHALLENGED to authenticate again; after " +
    "re-authenticating, the action completes with a fresh auth_time. The control path proves a plain " +
    "re-authorize (no prompt=login) rides the session silently. The whole sandbox (client + user) is " +
    "hard-deleted on teardown. Step-up is requested by the RP via a standard OIDC parameter, so no " +
    "step-up-specific recipe action or scope is needed.",
  steps: [
    { key: "firstSignin", title: STEPS.firstSignin },
    { key: "stepUp", title: STEPS.stepUp },
    { key: "reauth", title: STEPS.reauth },
  ],
  errorPath: {
    title: "A plain re-authorize (no prompt=login) rides the active session silently — no re-challenge",
  },
  // FIRST-LIVE-CONFIRM seams (validated on the first live run, like the original sandbox-signin).
  liveConfirm: [
    "A `prompt=login` authorize re-challenges an active session at the hosted login form (#passwordForm), rather than silently issuing a code (needs the SSO-3071 hub re-auth fix live).",
    "A plain re-authorize reuses the session with no password prompt.",
    "After re-authenticating, /protected renders with an auth_time not older than the first sign-in.",
  ],
};
