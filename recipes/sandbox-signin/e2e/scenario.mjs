// SSO-2969 — declared scenario metadata for the `sandbox-signin` colocated E2E.
//
// ONE source of truth for the journey's step titles: imported by
//   • sandbox-signin-journey.spec.ts — the `test.step(STEPS.x, …)` leg titles, and
//   • the shared results reporter + init generator — the declared "Steps" list in
//     recipes/sandbox-signin/E2E_RESULTS.md.

/** Step titles, keyed so the spec can reference them readably. */
export const STEPS = {
  sandboxIssuer:
    "RP → “Sign in with Thoryn” → authorize redirects to the SANDBOX per-env issuer, hosted login renders",
  register: "Follow the self-service sign-up path and register a brand-new end user in the sandbox",
  capture: "Capture the REAL verification email from the in-job Mailpit sink",
  verify: "Follow the captured verify-email link → “Your email is verified”",
  signin:
    "Return to the RP, sign in → land on /protected; the id_token `env` claim names the sandbox",
};

export const scenario = {
  id: "sandbox-signin",
  workflow: ".github/workflows/sandbox-e2e.yml",
  title:
    "Per-run sandbox: sign up → verify email → sign in against the sandbox per-env issuer (Path B)",
  summary:
    "Drives the `sandbox-signin` recipe's loopback relying party against the staging SaaS in a " +
    "real browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create) inside the standing " +
    "workspace rather than a new workspace. A brand-new end user signs up on the sandbox's hosted " +
    "login; the verification email is captured from an ephemeral in-job Mailpit sink via the " +
    "standing workspace's BYO-SMTP; the captured link verifies the account; the user then completes " +
    "the OIDC Authorization-Code + PKCE flow back to the RP's protected page. The whole sandbox " +
    "(client + user) is hard-deleted on teardown. " +
    "The headline flow mirrors the recipe README's sandbox test-inbox round trip " +
    "(`thoryn env test-emails`); this browser harness captures the same genuinely-sent email from " +
    "the CI Mailpit sink instead of the CLI inbox, because the runner drives the hosted UI, not the CLI.",
  steps: [
    { key: "sandboxIssuer", title: STEPS.sandboxIssuer },
    { key: "register", title: STEPS.register },
    { key: "capture", title: STEPS.capture },
    { key: "verify", title: STEPS.verify },
    { key: "signin", title: STEPS.signin },
  ],
  errorPath: {
    title: "A garbage verify-email token shows the neutral “this link is invalid” screen",
  },
  // Capabilities the FIRST LIVE sandbox run must confirm (mirrors the NOTE(SSO-2969) markers in
  // the recipe + workflow). Rendered as context so a reader knows what is asserted vs. deferred.
  liveConfirm: [
    "identity.registerUser + self-service sign-up are honoured PER-ENVIRONMENT (user sign-in-able against the sandbox issuer, not only workspace scope).",
    "The sandbox per-env issuer resolves (workspace issuer + /{env-slug} path) and serves the hosted login.",
    "BYO-SMTP configured at the WORKSPACE level still routes a sandbox sign-up's verification email to the in-job Mailpit sink.",
  ],
};
