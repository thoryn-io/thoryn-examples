/**
 * SSO-2909 — config for the simple-signin example e2e harness.
 *
 * Defaults target the STAGING SaaS (hub.stg.thoryn.org / identity.stg.thoryn.org).
 * Every value is overridable by env so the same harness runs in CI (example-e2e.yml)
 * and locally against a workspace you provisioned by hand.
 *
 * Unlike oathy's e2e/scenario (which drives the SEEDED thoryn-demo client and
 * intercepts the loopback callback), this harness drives the REAL standalone
 * loopback RP (recipes/simple-signin/apps/loopback-rp/server.js) the recipe ships,
 * so the journey exercises exactly the app a customer would run.
 */

/** Mailtrap Email Testing inbox coordinates — read straight from env (CI secrets). */
export const mailtrap = {
  apiBaseUrl: process.env.MAILTRAP_API_BASE_URL ?? "https://mailtrap.io",
  accountId: process.env.MAILTRAP_ACCOUNT_ID ?? "",
  inboxId: process.env.MAILTRAP_INBOX_ID ?? "",
  apiToken: process.env.MAILTRAP_API_TOKEN ?? "",
} as const;

export const config = {
  /**
   * The loopback RP origin (the app the end user signs in to). The workflow starts
   * `server.js` on 127.0.0.1:PORT and passes it THORYN_ISSUER + THORYN_CLIENT_ID
   * from the `thoryn examples apply` receipt.
   */
  rpBaseUrl: process.env.RP_BASE_URL ?? "http://127.0.0.1:8471",

  /**
   * The workspace hub issuer the recipe provisioned (`{slug}.hub.stg.thoryn.org`).
   * The RP redirects here for /oauth2/authorize; the harness uses it only to
   * sanity-check the redirect target.
   */
  issuerBaseUrl: process.env.THORYN_ISSUER ?? "",

  /** The public client-id the recipe created (`app-XXXXXXXX`). */
  clientId: process.env.THORYN_CLIENT_ID ?? "",

  /**
   * identity-service public host — where the tenant's hosted self-service sign-up
   * form + login form are served and where the verification-email LINK points.
   *
   * OPEN (first-live-run item): for a NON-default workspace tenant the exact host
   * that serves /register and /login (the tenant's own identity subdomain vs. the
   * shared default-tenant identity host) is unverified. The journey primarily
   * navigates via the RP → workspace hub → hosted login, so it does not hardcode
   * the host into the click-path; this value is the fallback/verify-link host and
   * is overridden by IDENTITY_BASE_URL in CI once confirmed.
   */
  identityBaseUrl: process.env.IDENTITY_BASE_URL ?? "https://identity.stg.thoryn.org",

  /** Mailtrap Email Testing inbox (see `mailtrap` above). */
  mailtrap,

  /** Credentials for the self-service sign-up. A fresh email per run (see uniqueEmail). */
  password: process.env.SIGNUP_PASSWORD ?? "Example-Signin-Pw1!",
  givenName: "Demo",
  familyName: "User",
} as const;
