/**
 * SSO-2909 — config for the simple-signin example e2e harness.
 *
 * Defaults target the browsable k3d overlay (docs/ci-e2e-plan.md): ingress at
 * *.127.0.0.1.nip.io, HTTPS via ingress-nginx's self-signed cert. Every value is
 * overridable by env so the same harness runs in CI (example-e2e.yml) and locally.
 *
 * Unlike oathy's e2e/scenario (which drives the SEEDED thoryn-demo client and
 * intercepts the loopback callback), this harness drives the REAL standalone
 * loopback RP (recipes/simple-signin/apps/loopback-rp/server.js) the recipe ships,
 * so the journey exercises exactly the app a customer would run.
 */
export const config = {
  /**
   * The loopback RP origin (the app the end user signs in to). The workflow
   * starts `server.js` on 127.0.0.1:PORT and passes it THORYN_ISSUER +
   * THORYN_CLIENT_ID from the `thoryn examples apply` output.
   */
  rpBaseUrl: process.env.RP_BASE_URL ?? "http://127.0.0.1:8471",

  /**
   * The workspace hub issuer the recipe provisioned (`{slug}.hub.127.0.0.1.nip.io`).
   * The RP redirects here for /oauth2/authorize; we only need it in the harness to
   * sanity-check the redirect target.
   */
  issuerBaseUrl: process.env.THORYN_ISSUER ?? "",

  /** The public client-id the recipe created (`app-XXXXXXXX`). */
  clientId: process.env.THORYN_CLIENT_ID ?? "",

  /**
   * identity-service public host — where the self-service sign-up form is served
   * and where the verification email is captured from. In oathy's proven journey
   * the email-capturing /register is on the DEFAULT-tenant identity host (not a
   * tenant subdomain); see docs/ci-e2e-plan.md §7 item 11 (OPEN QUESTION).
   */
  identityBaseUrl: process.env.IDENTITY_BASE_URL ?? "https://identity.127.0.0.1.nip.io",

  /**
   * Mailpit test-SMTP HTTP API host. The browsable stack points identity's SMTP at
   * Mailpit and exposes its API here. We poll GET {mailpitBaseUrl}/api/v1/messages
   * to CAPTURE the real verification email — never injected, never read from the DB.
   */
  mailpitBaseUrl: process.env.MAILPIT_BASE_URL ?? "https://mailpit.127.0.0.1.nip.io",

  /** Credentials for the self-service sign-up. A fresh email per run (see uniqueEmail). */
  password: process.env.SIGNUP_PASSWORD ?? "Example-Signin-Pw1!",
  givenName: "Demo",
  familyName: "User",
} as const;
