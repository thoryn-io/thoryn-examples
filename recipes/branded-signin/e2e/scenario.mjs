// SSO-3039 — declared scenario metadata for the `branded-signin` colocated E2E.
//
// ONE source of truth for the journey's step titles: imported by
//   • branded-signin-journey.spec.ts — the `test.step(STEPS.x, …)` leg titles, and
//   • the shared results reporter + init generator — the declared "Steps" list in
//     recipes/branded-signin/E2E_RESULTS.md.

/** Step titles, keyed so the spec can reference them readably. */
export const STEPS = {
  sandboxIssuer:
    "RP → “Sign in with Thoryn” → the sandbox hosted login renders WITH the recipe's brand color",
  register: "Follow the self-service sign-up path and register a brand-new end user in the sandbox",
  capture: "Capture the REAL verification email from the sandbox test-inbox (thoryn env test-emails)",
  verify: "Follow the captured verify-email link → “Your email is verified”",
  signin:
    "Return to the RP, sign in → land on /protected; the id_token `env` claim names the sandbox",
};

export const scenario = {
  id: "branded-signin",
  workflow: ".github/workflows/branded-signin-e2e.yml",
  title:
    "Per-run sandbox with a BRANDED hosted login: style → sign up → verify → sign in (Path B)",
  summary:
    "Drives the `branded-signin` recipe's loopback relying party against the staging SaaS in a real " +
    "browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create) inside the standing workspace. " +
    "The recipe's `tenant.configureLoginTheme` step styles that sandbox's hosted sign-in screen " +
    "(primaryColor #7c3aed) via the same customer-plane surface `thoryn branding set` wraps — and the " +
    "journey ASSERTS the rendered login carries that brand (the `--brand-primary` CSS custom property). " +
    "A brand-new end user then signs up; because a sandbox SUPPRESSES real transactional email by design " +
    "(SSO-2449) and captures it into a per-env inbox (SSO-3026), the verification email is read from that " +
    "sandbox test-inbox via the CLI (`thoryn env test-emails`); the captured link verifies the account; " +
    "the user completes the OIDC Authorization-Code + PKCE flow back to the RP's protected page. The whole " +
    "sandbox (client + user + branding) is hard-deleted on teardown.",
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
  // What this recipe proves beyond sandbox-signin: the login is BRANDED per environment.
  liveConfirm: [
    "The recipe's tenant.configureLoginTheme step styles the sandbox's hosted login PER ENVIRONMENT (SSO-3037).",
    "The rendered hosted login carries the configured brand: the `--brand-primary` CSS custom property equals the recipe's primaryColor.",
    "The branding is env-scoped and torn down with the sandbox (the env hard-delete cascades the branding row).",
  ],
};
