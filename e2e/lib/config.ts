/**
 * SSO-2909 / SSO-2969 — SHARED config for the example e2e harness, imported by every
 * recipe's colocated spec (recipes/<id>/e2e/*.spec.ts). It is entirely env-driven and
 * recipe-agnostic: simple-signin and sandbox-signin differ only in the issuer/client the
 * workflow injects (a fresh workspace vs. a per-run sandbox per-env issuer), not in the
 * harness.
 *
 * Defaults target the STAGING SaaS (hub.stg.thoryn.org / identity.stg.thoryn.org).
 * Every value is overridable by env so the same harness runs in CI (example-e2e.yml /
 * sandbox-e2e.yml) and locally against an issuer/client you provisioned by hand.
 *
 * Unlike oathy's e2e/scenario (which drives the SEEDED thoryn-demo client and
 * intercepts the loopback callback), this harness drives the REAL standalone
 * loopback RP (recipes/simple-signin/apps/loopback-rp/server.js) the recipe ships,
 * so the journey exercises exactly the app a customer would run.
 */

/**
 * Ephemeral in-job Mailpit sink coordinates. The workflow starts Mailpit as a
 * Docker container INSIDE the CI job and the harness reads it over Mailpit's
 * LOCAL HTTP API — no auth, no tunnel (the tunnel is SMTP-only, so identity can
 * deliver the email; the read side stays on localhost). `baseUrl` therefore
 * defaults to `http://localhost:8025` and is overridable only for a local run
 * against a hand-started Mailpit.
 */
export const mailpit = {
  baseUrl: process.env.MAILPIT_BASE_URL ?? "http://localhost:8025",
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

  /** Ephemeral in-job Mailpit sink (see `mailpit` above). */
  mailpit,

  /**
   * SSO-3033 / SSO-3036 — the `thoryn` CLI, used by the SANDBOX journey to read the
   * verification email from the sandbox TEST-INBOX (SSO-3026) instead of Mailpit. A
   * sandbox SUPPRESSES real transactional email by design (`TestModeEmailGate`, SSO-2449)
   * and captures it into a per-env inbox; the workflow's BYO-SMTP only ever carries a
   * WORKSPACE-plane email, so a sandbox sign-up's verification link never reaches the sink.
   * The inbox is the correct, non-faked capture channel for a sandbox — the email is really
   * generated and stored, and we read it through the product's own read API via the CLI.
   *
   * `jarPath` is the prebuilt `thoryn.jar` on the runner (the same one the workflow uses for
   * apply/teardown, already signed in with a session that carries tenant:environments.read);
   * `envSlug` is the recipe's sandbox (in CI its long-lived fixture `ci-<recipe>`, SSO-3113). Every
   * journey, simple-signin included since SSO-3131, captures its mail this way.
   */
  cli: {
    jarPath: process.env.THORYN_JAR ?? "",
    envSlug: process.env.SANDBOX_ENV_SLUG ?? "",
    /**
     * SSO-3081 — the pieces the suspended-login negative case (simple-signin) needs to drive a
     * user SUSPEND through the supported `thoryn users suspend` surface. The helper authenticates
     * a FRESH client-credentials session into an ISOLATED token store (its own HOME) requesting
     * ONLY `tenant:users.{write,read}`, so a missing scope grant fails just that one test rather
     * than the whole suite, and never clobbers the provisioning session the teardown reuses.
     * `apiKey` is the same `<client-id>:<client-secret>` the workflow signs in with; `workspaceSlug`
     * is the standing workspace (the `--confirm` value on the production plane). All empty locally →
     * the suspended test skips. `issuer` is where that client-credentials session signs in: the
     * WORKSPACE issuer (`THORYN_CLI_LOGIN_ISSUER`, SSO-3131) — the CI identity is a production-plane
     * client that manages the sandbox, so it does not sign in at the sandbox's per-env issuer
     * (`THORYN_ISSUER`, which the RP uses). Falls back to `THORYN_ISSUER` for a local run.
     */
    apiKey: process.env.THORYN_API_KEY ?? "",
    issuer: process.env.THORYN_CLI_LOGIN_ISSUER || process.env.THORYN_ISSUER || "",
    gateway: process.env.THORYN_GATEWAY ?? "https://api.stg.thoryn.org",
    workspaceSlug: process.env.THORYN_WORKSPACE_SLUG ?? "",
    /**
     * SSO-3068/SSO-3081 — the environment the suspend targets (rides `--environment` →
     * X-Thoryn-Environment). Self-service users registered through a marker-less RP authorize land in
     * `production` (LoginModeResolver.currentLoginEnvironmentSlug default; confirmed against staging's
     * identity DB), and a client-credentials/CI session can't select an environment via `env use`, so
     * the suspend must name it explicitly. In CI the journey runs inside the recipe's sandbox (SSO-3131), so the
     * workflow sets THORYN_USERS_ENVIRONMENT to that sandbox's slug; `production` is only the local default.
     */
    usersEnvironment: process.env.THORYN_USERS_ENVIRONMENT ?? "production",
  },

  /** Credentials for the self-service sign-up. A fresh email per run (see uniqueEmail). */
  password: process.env.SIGNUP_PASSWORD ?? "Example-Signin-Pw1!",
  givenName: "Demo",
  familyName: "User",
} as const;
