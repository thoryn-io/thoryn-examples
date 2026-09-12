// SSO-3047 (epic SSO-3046) — declared scenario metadata for the `magic-link-signin` colocated E2E.
// ONE source of truth for the journey's step titles (imported by the spec + the results reporter).

export const STEPS = {
  request:
    "Request a passwordless sign-in link on the hosted login (sets the ML_INIT device cookie)",
  capture:
    "Capture the single-use magic link from the sandbox test inbox (channel magic_link)",
  consume:
    "Open the link on the SAME device → authenticated → OAuth resumes → /protected",
};

export const scenario = {
  id: "magic-link-signin",
  workflow: ".github/workflows/magic-link-signin-e2e.yml",
  title: "Passwordless (magic link), same device: request a link, open it here, you're signed in",
  summary:
    "Drives the `magic-link-signin` recipe's loopback relying party against the staging SaaS in a " +
    "real browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create). A verified user signs " +
    "in with NO password: on the hosted login they choose 'email me a sign-in link' (identity " +
    "POST /auth/magic-link/request), the email is captured from the per-run sandbox test inbox " +
    "(suppressed from real SMTP by TestModeEmailGate, channel magic_link, read via `thoryn env " +
    "test-emails`), and opening that single-use link ON THE SAME device — the one that started the " +
    "sign-in, carrying the ML_INIT cookie — authenticates the session and resumes /oauth2/authorize " +
    "to the RP protected page. A bogus/expired token is rejected. The whole sandbox (client + user) " +
    "is hard-deleted on teardown. Magic-link is on by default, so no login-method recipe action is needed.",
  steps: [
    { key: "request", title: STEPS.request },
    { key: "capture", title: STEPS.capture },
    { key: "consume", title: STEPS.consume },
  ],
  errorPath: {
    title: "An invalid/expired magic-link token does not sign the user in",
  },
  // FIRST-LIVE-CONFIRM seams (validated on the first live run, like the original sandbox-signin).
  liveConfirm: [
    "The hosted login offers the magic-link affordance (#magicLinkToggle → #magicLinkForm → #magicLinkEmail) — magic-link is in the default login-method order.",
    "The sandbox test inbox captures the magic-link email on channel `magic_link` with the consume URL (/auth/magic-link/consume?token=…) as its actionLink.",
    "Opening the link in the SAME browser context (matching ML_INIT) authenticates and resumes /oauth2/authorize to the RP /protected page.",
  ],
};
