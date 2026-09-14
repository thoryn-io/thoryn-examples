// SSO-2595 (epic SSO-3042) — declared scenario metadata for the `magic-code-signin` colocated E2E.
// ONE source of truth for the journey's step titles (imported by the spec + the results reporter).

export const STEPS = {
  enable:
    "Enable magic-code for the sandbox (thoryn login-methods set --method magic_code)",
  request:
    "On the hosted login, request a 6-digit code (email me a code)",
  capture:
    "Capture the code from the sandbox test-inbox (channel magic_code)",
  verify:
    "Type the captured code → passwordless sign-in reaches the RP protected page",
};

export const scenario = {
  id: "magic-code-signin",
  workflow: ".github/workflows/magic-code-signin-e2e.yml",
  title: "Passwordless (magic-code): request a 6-digit email OTP, type it, and sign in",
  summary:
    "Drives the `magic-code-signin` recipe's loopback relying party against the staging SaaS in a real " +
    "browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create). Magic-code is OPT-IN, so the " +
    "journey first ENABLES it for the sandbox with `thoryn login-methods set --environment <slug> " +
    "--method password --method magic_link --method magic_code` (SSO-3075) — a supported CLI action, " +
    "not a raw API call; per-environment enforcement (SSO-3073) makes the sandbox login offer it " +
    "without touching production. Then a verified user requests a 6-digit code on the hosted login, the " +
    "code is CAPTURED from the sandbox test-inbox (SSO-3074, channel magic_code — the code is dropped " +
    "from real SMTP in a sandbox and captured instead), typed back on the login page, and the OAuth " +
    "flow resumes to the RP protected page. A wrong code is rejected. The whole sandbox (client + user " +
    "+ login-method policy) is hard-deleted on teardown.",
  steps: [
    { key: "enable", title: STEPS.enable },
    { key: "request", title: STEPS.request },
    { key: "capture", title: STEPS.capture },
    { key: "verify", title: STEPS.verify },
  ],
  errorPath: {
    title: "A wrong 6-digit code is rejected at the hosted magic-code challenge",
  },
  // FIRST-LIVE-CONFIRM seams (validated on the first live run).
  liveConfirm: [
    "`thoryn login-methods set --method magic_code` makes the sandbox login render the #magicCode affordance (needs SSO-3073 env-scoped enforcement live).",
    "The sandbox test-inbox captures the code on channel `magic_code` (needs SSO-3074 live).",
    "The hosted /auth/magic-code request (#magicCodeRequestForm) + verify (#magicCodeVerifyForm / #magicCodeInput) selectors; a wrong code surfaces #magicCodeError.",
  ],
};
