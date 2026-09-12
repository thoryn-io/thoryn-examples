// SSO-2909 — declared scenario metadata for the `simple-signin` colocated E2E.
//
// ONE source of truth for the journey's step titles: imported by
//   • simple-signin-journey.spec.ts — the `test.step(STEPS.x, …)` leg titles, and
//   • the shared results reporter + init generator — the declared "Steps" list in
//     recipes/simple-signin/E2E_RESULTS.md.
// Keeping the titles here means the spec, the live report, and the seeded placeholder
// never drift.

/** Step titles, keyed so the spec can reference them readably. */
export const STEPS = {
  hostedLogin: "RP → “Sign in with Thoryn” → the tenant hosted login renders via the workspace hub",
  register: "Follow the self-service sign-up path and register a brand-new end user",
  capture: "Capture the REAL verification email from the in-job Mailpit sink",
  verify: "Follow the captured verify-email link → “Your email is verified”",
  signin: "Return to the RP, sign in with the verified creds → land on /protected",
};

export const scenario = {
  id: "simple-signin",
  workflow: ".github/workflows/example-e2e.yml",
  title:
    "Self-service sign-up → verify email → sign in through the recipe's loopback RP (Path B)",
  summary:
    "Drives the `simple-signin` recipe's real loopback relying party against the staging SaaS " +
    "in a real browser. A brand-new end user signs up on the provisioned workspace's hosted " +
    "login; identity sends a genuine verification email over the tenant's BYO-SMTP, captured " +
    "from an ephemeral in-job Mailpit sink (no DB injection, no stubbing); the captured link " +
    "verifies the account; the user then completes the OIDC Authorization-Code + PKCE flow back " +
    "to the RP's protected page, which renders the ID-token claims.",
  steps: [
    { key: "hostedLogin", title: STEPS.hostedLogin },
    { key: "register", title: STEPS.register },
    { key: "capture", title: STEPS.capture },
    { key: "verify", title: STEPS.verify },
    { key: "signin", title: STEPS.signin },
  ],
  errorPath: {
    title: "A garbage verify-email token shows the neutral “this link is invalid” screen",
  },
};
