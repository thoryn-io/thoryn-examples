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
  capture: "Capture the REAL verification email from the sandbox test-inbox (thoryn env test-emails)",
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
    "login; because a sandbox SUPPRESSES real transactional email by design (SSO-2449) and captures " +
    "it into a per-env inbox (SSO-3026), the verification email is read from that sandbox test-inbox " +
    "via the CLI (`thoryn env test-emails`); the captured link verifies the account; the user then " +
    "completes the OIDC Authorization-Code + PKCE flow back to the RP's protected page. The whole " +
    "sandbox (client + user) is hard-deleted on teardown. " +
    "This is the recipe README's headline sandbox test-inbox round trip — a genuine, non-faked " +
    "capture of the real email through the product's own read surface (simple-signin, a workspace " +
    "where email really sends, stays on the Mailpit path).",
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
  // Sandbox-specific seams, LIVE-CONFIRMED on staging 2026-09-12 (SSO-3033/SSO-3036).
  liveConfirm: [
    "identity.registerUser + self-service sign-up are honoured PER-ENVIRONMENT (user sign-in-able against the sandbox issuer, not only workspace scope).",
    "The sandbox per-env issuer resolves (workspace issuer + /{env-slug} path) and serves the hosted login; the sandbox client is auto-attached to its env-scoped identity-service member (SSO-3036), so sign-in no longer hits federation_required.",
    "A sandbox sign-up's verification email is SUPPRESSED from SMTP by design (SSO-2449) and captured to the per-env test-inbox (SSO-3026), read here via `thoryn env test-emails` — NOT the Mailpit sink.",
  ],
};
