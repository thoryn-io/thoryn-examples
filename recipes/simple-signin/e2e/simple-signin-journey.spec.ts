/**
 * SSO-2909 — the `simple-signin` example, driven end-to-end in a real browser against
 * the STAGING SaaS, INCLUDING a genuinely-sent verification email captured from an
 * EPHEMERAL, in-job Mailpit sink. This is Path B (real self-service sign-up +
 * email capture): a brand-new end user registers on the provisioned workspace, which
 * makes identity SEND a verification email over the tenant's BYO-SMTP (pointed at a
 * public TCP tunnel to the in-job Mailpit by the workflow; the harness reads it back
 * on localhost). The recipe's own identity.registerUser step pre-verifies
 * WITHOUT an email — that is a convenience for the conformance run, not this path.
 *
 * This spec is COLOCATED with the recipe it validates (recipes/simple-signin/e2e/).
 * It imports the SHARED harness (config, Mailpit capture) from the repo-root `e2e/`
 * tree — the one reusable home both recipes' specs import, so there is no duplicated
 * setup. The step titles come from ./scenario.mjs (the single source the generated
 * E2E_RESULTS.md "Steps" list uses too).
 *
 *   1. Open the REAL loopback RP (../apps/loopback-rp/server.js):
 *      GET / → "Sign in with Thoryn" → RP 302s to {workspace-issuer}/oauth2/authorize
 *      → the hub federates to the tenant's identity → its hosted login renders.
 *   2. From the hosted login, follow the self-service "Sign up / Create account"
 *      path → fill the register form with a UNIQUE email → "Check your email".
 *   3. Poll Mailpit's API until the verification email to THIS address lands;
 *      extract the real `<identity>/verify-email?token=…` link from its body.
 *   4. Follow the link → branded "Your email is verified" (single-use token consumed).
 *   5. Return to the RP → Sign in → hosted login → sign in with the registered creds
 *      → callback → RP /protected renders the ID-token claims. Assert we are signed in.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — activates once the maintainer creates the CI secrets (see          │
 * │ e2e/README.md) and a FIRST live run confirms the three unproven seams marked  │
 * │ `LIVE-CONFIRM` below:                                                          │
 * │  (a) the tenant hosted-login → self-service register entry (selectors + that   │
 * │      self-service sign-up is enabled on the cloned identity member),           │
 * │  (b) BYO-SMTP → Mailpit actually delivers the verification email, and          │
 * │  (c) the freshly-verified account completes the RP OIDC round-trip.            │
 * │ Form selectors mirror oathy e2e/scenario/tests/hosted-signup-to-console.spec   │
 * │ (register.html #registerForm / login.html #passwordForm).                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { findVerificationLink, findResetLink, findUnlockLink } from "../../../e2e/lib/mailbox";
import { userAdminConfigured, loginForUserAdmin, suspendUserByEmail, listUsersDiagnostic } from "../../../e2e/lib/user-admin.mjs";
import { STEPS } from "./scenario.mjs";

/** Unique per run so reruns never 409 and the Mailpit match is unambiguous. */
function uniqueEmail(): string {
  return `example-signin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@thoryn.test`;
}

/** RP landing → "Sign in with Thoryn" → the tenant's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/**
 * LIVE-CONFIRM (a): from the hosted login, reach the self-service register form.
 * The hosted login exposes a "Sign up" / "Create account" affordance when the
 * tenant's identity member has self-service registration enabled. The exact link
 * text + whether it is enabled on the cloned member must be confirmed on the first
 * live run; adjust the accessible name here if it differs.
 */
async function gotoRegisterFromLogin(page: Page): Promise<void> {
  await page.getByRole("link", { name: /sign up|create account|register/i }).click();
  await expect(page.locator("#registerForm")).toBeVisible();
}

/** Fill + submit the hosted self-service sign-up form (identity register.html). */
async function submitRegistration(page: Page, email: string): Promise<void> {
  await page.locator("#email").fill(email);
  await page.locator("#givenName").fill(config.givenName);
  await page.locator("#familyName").fill(config.familyName);
  await page.locator("#password").fill(config.password);
  await page.locator("#confirmPassword").fill(config.password);
  await page.locator("#registerForm button[type=submit]").click();
}

/** Fill + submit the hosted login form (identity login.html #passwordForm). */
async function submitLogin(page: Page, email: string): Promise<void> {
  await submitLoginWith(page, email, config.password);
}

/** Fill + submit the hosted login form with an EXPLICIT password (SSO-3078: after a reset the password changed). */
async function submitLoginWith(page: Page, email: string, password: string): Promise<void> {
  await page.locator("#passwordEmail").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#passwordForm button[type=submit]").click();
}

/** Register a brand-new end user and verify their email via the captured Mailpit link. */
async function registerAndVerify(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await startSignInFromRp(page);
  await expect(page.locator("#passwordForm")).toBeVisible();
  await gotoRegisterFromLogin(page);
  await submitRegistration(page, email);
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  let verifyLink: string | null = null;
  await expect
    .poll(
      async () => {
        verifyLink = await findVerificationLink(request, config.mailpit, email);
        return verifyLink;
      },
      { timeout: 90_000, intervals: [1000, 2000, 3000, 5000] },
    )
    .not.toBeNull();
  await page.goto(verifyLink!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /your email is verified/i })).toBeVisible();
}

test.describe("simple-signin example — self-service sign-up → verify email → sign in via the loopback RP (SSO-2909)", () => {
  test("full Path-B journey signs a verified user in to the RP's protected page", async ({
    browser,
    request,
  }) => {
    // RP round-trip + TWO real emails (verify + reset) + Mailpit polling + several hosted form legs.
    test.setTimeout(300_000);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = uniqueEmail();
    // SSO-3078: the reset legs run in a SECOND, session-less context so the hosted login FORM renders
    // (an authenticated session would SSO straight through the 'Forgot your password?' entry).
    let context2: BrowserContext | null = null;

    try {
      // 1) RP → "Sign in with Thoryn" → the workspace hub → the hosted login form.
      await test.step(STEPS.hostedLogin, async () => {
        await startSignInFromRp(page);
        await expect(
          page.locator("#passwordForm"),
          "the RP sign-in reaches the identity hosted login via the workspace hub",
        ).toBeVisible();
      });

      // 2) Follow the self-service sign-up path and register a brand-new end user.
      await test.step(STEPS.register, async () => {
        await gotoRegisterFromLogin(page); // LIVE-CONFIRM (a)
        await submitRegistration(page, email);
        await expect(
          page.getByRole("heading", { name: /check your email/i }),
          "self-service sign-up hands off to the verify-email screen",
        ).toBeVisible();
      });

      // 3) Capture the REAL verification email from Mailpit (SMTP-delivered by
      //    identity through the tenant's BYO-SMTP). LIVE-CONFIRM (b).
      let verifyLink: string | null = null;
      await test.step(STEPS.capture, async () => {
        await expect
          .poll(
            async () => {
              verifyLink = await findVerificationLink(request, config.mailpit, email);
              return verifyLink;
            },
            {
              // The identity email send is queued/async; allow generous delivery time.
              message: `verification email to ${email} captured from Mailpit sink ${config.mailpit.baseUrl}`,
              timeout: 90_000,
              intervals: [1000, 2000, 3000, 5000],
            },
          )
          .not.toBeNull();
        expect(
          verifyLink!,
          "verification link points at the identity verify-email landing",
        ).toContain("/verify-email?token=");
      });

      // 4) Follow the real link → branded "verified" success (token consumed server-side).
      await test.step(STEPS.verify, async () => {
        await page.goto(verifyLink!, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("heading", { name: /your email is verified/i }),
          "the captured verification link verifies the email",
        ).toBeVisible();
      });

      // 5) Return to the RP and complete the OIDC login with the verified creds.
      //    LIVE-CONFIRM (c): the account just verified on the tenant's identity
      //    authenticates through the workspace hub federation and back to the RP.
      await test.step(STEPS.signin, async () => {
        await startSignInFromRp(page);
        await expect(page.locator("#passwordForm")).toBeVisible();
        await submitLogin(page, email);

        // Back on the loopback RP's protected page, signed in.
        await expect(
          page.getByText(/you are signed in as/i),
          "the OIDC code flow completes and the RP renders its protected page",
        ).toBeVisible({ timeout: 30_000 });
        // The RP renders the signed-in email in more than one place (a heading <strong>
        // and the claims table <td>), so scope to the first match to avoid a strict-mode
        // violation — presence anywhere proves the correct user is signed in.
        await expect(page.getByText(email, { exact: false }).first()).toBeVisible();
      });

      // 6) SSO-3078 — self-service PASSWORD RESET. A FRESH, session-less context so the hosted
      //    login form (and its "Forgot your password?" link) actually renders.
      context2 = await browser.newContext({ ignoreHTTPSErrors: true });
      const page2 = await context2.newPage();
      const newPassword = `Reset-${Date.now()}-Pw2!`;

      await test.step(STEPS.forgot, async () => {
        await startSignInFromRp(page2);
        await expect(page2.locator("#passwordForm")).toBeVisible();
        await page2.locator("#forgotPasswordLink").click();
        await expect(
          page2.locator("input[name=email]"),
          "the login's forgot-password link reaches identity's /password-reset/initiate form",
        ).toBeVisible();
        await page2.locator("input[name=email]").fill(email);
        await page2.locator("button[type=submit]").click();
        await expect(
          page2.getByText(/you will receive a password reset link/i),
          "the reset request returns the constant-time, non-enumerating confirmation",
        ).toBeVisible();
      });

      // 7) Capture the REAL password-reset email from the SAME in-job Mailpit sink.
      let resetLink: string | null = null;
      await test.step(STEPS.captureReset, async () => {
        await expect
          .poll(
            async () => {
              resetLink = await findResetLink(request, config.mailpit, email);
              return resetLink;
            },
            {
              message: `password-reset email to ${email} captured from Mailpit sink ${config.mailpit.baseUrl}`,
              timeout: 90_000,
              intervals: [1000, 2000, 3000, 5000],
            },
          )
          .not.toBeNull();
        expect(
          resetLink!,
          "reset link points at identity's password-reset page",
        ).toContain("/password-reset?token=");
      });

      // 8) Follow the captured link → set a NEW password → success.
      await test.step(STEPS.reset, async () => {
        await page2.goto(resetLink!, { waitUntil: "domcontentloaded" });
        await expect(
          page2.locator("input[name=newPassword]"),
          "the captured reset link opens the set-new-password form",
        ).toBeVisible();
        await page2.locator("input[name=newPassword]").fill(newPassword);
        await page2.locator("input[name=confirmPassword]").fill(newPassword);
        await page2.locator("button[type=submit]").click();
        await expect(
          page2.getByText(/your password has been updated/i),
          "setting the new password succeeds and the single-use token is consumed",
        ).toBeVisible();
      });

      // 9) Sign in with the NEW password → back on the RP protected page.
      await test.step(STEPS.signinNew, async () => {
        await startSignInFromRp(page2);
        await expect(page2.locator("#passwordForm")).toBeVisible();
        await submitLoginWith(page2, email, newPassword);
        await expect(
          page2.getByText(/you are signed in as/i),
          "signing in with the NEW password completes the OIDC flow to the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
        await expect(page2.getByText(email, { exact: false }).first()).toBeVisible();
      });
    } finally {
      if (context2) await context2.close();
      await context.close();
    }
  });

  test(
    "account unlock: five wrong passwords lock the account, then the emailed unlock link restores sign-in (SSO-1905)",
    async ({ browser, request }) => {
      // Register + verify (fresh account) + lock (5 attempts) + unlock email + landing + sign in.
      test.setTimeout(300_000);

      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const email = uniqueEmail();

      try {
        // Pre-req: a real, verified account with a known password (so a lock is meaningful).
        await test.step("Register + verify a fresh end user to lock", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          await gotoRegisterFromLogin(page);
          await submitRegistration(page, email);
          await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
          let verifyLink: string | null = null;
          await expect
            .poll(
              async () => {
                verifyLink = await findVerificationLink(request, config.mailpit, email);
                return verifyLink;
              },
              { timeout: 90_000, intervals: [1000, 2000, 3000, 5000] },
            )
            .not.toBeNull();
          await page.goto(verifyLink!, { waitUntil: "domcontentloaded" });
          await expect(page.getByRole("heading", { name: /your email is verified/i })).toBeVisible();
        });

        // LOCK: the SSO-1895 per-account lockout trips after 5 consecutive failures. The hosted
        // login error is deliberately GENERIC (no lock-state / existence leak), so we assert only
        // that each attempt stays on the login form (never reaches the RP protected page).
        await test.step("Five consecutive wrong-password attempts lock the account", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          for (let i = 0; i < 5; i++) {
            await submitLoginWith(page, email, `wrong-password-${i}`);
            await expect(
              page.locator("#passwordForm"),
              "a rejected password re-renders the login form (generic error, no lock-state leak)",
            ).toBeVisible();
          }
        });

        // UNLOCK: request an unlock link via the login's "Unlock via email" affordance. The request
        // endpoint is constant-time and its own limiter (independent of the form-login velocity cap).
        await test.step("Request an unlock link via the login 'Unlock via email' affordance", async () => {
          await page.locator("#unlockToggle").click();
          await expect(page.locator("#unlockEmail")).toBeVisible();
          await page.locator("#unlockEmail").fill(email);
          await page.locator("#unlockForm button[type=submit]").click();
          await expect(
            page.locator("#unlockStatus"),
            "the unlock request returns the constant-time, non-enumerating confirmation",
          ).toContainText(/unlock link is on its way/i);
        });

        // Capture the REAL unlock email from the same in-job Mailpit sink + confirm on the landing page.
        let unlockLink: string | null = null;
        await test.step("Capture the unlock email and confirm on the landing page", async () => {
          await expect
            .poll(
              async () => {
                unlockLink = await findUnlockLink(request, config.mailpit, email);
                return unlockLink;
              },
              {
                message: `unlock email to ${email} captured from Mailpit sink ${config.mailpit.baseUrl}`,
                timeout: 90_000,
                intervals: [1000, 2000, 3000, 5000],
              },
            )
            .not.toBeNull();
          expect(unlockLink!, "unlock link points at identity's account-unlock landing").toContain(
            "/account/unlock?token=",
          );
          await page.goto(unlockLink!, { waitUntil: "domcontentloaded" });
          await page.getByRole("button", { name: /unlock my account/i }).click();
          await expect(
            page.getByRole("heading", { name: /account unlocked/i }),
            "confirming the unlock token unlocks the account",
          ).toBeVisible();
        });

        // Sign in with the CORRECT password → RP protected. Small settle so the per-username form-login
        // minute budget (5/min — exactly the 5 lock attempts) has refilled a token for this login.
        await test.step("Sign in with the correct password → land back on /protected", async () => {
          await page.waitForTimeout(15_000);
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          await submitLoginWith(page, email, config.password);
          await expect(
            page.getByText(/you are signed in as/i),
            "the unlocked account signs in with the original password and reaches the RP protected page",
          ).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText(email, { exact: false }).first()).toBeVisible();
        });
      } finally {
        await context.close();
      }
    },
  );

  test(
    "sign-out: RP-Initiated Logout round-trips a loopback RP back to its post_logout_redirect_uri (OIDC RP-Initiated Logout 1.0 + RFC 8252, SSO-3080)",
    async ({ browser, request }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const email = uniqueEmail();
      try {
        await registerAndVerify(page, request, email);

        await test.step("Sign in → land on the RP protected page", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          await submitLogin(page, email);
          await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
        });

        await test.step("Sign out drops the RP session and RP-Initiated Logout returns the browser to the RP home", async () => {
          // The RP's GET /logout clears its own cookie and 302s to the hub end_session_endpoint with
          // id_token_hint + post_logout_redirect_uri=http://127.0.0.1:<port>/. The client registered a
          // PORT-LESS loopback post-logout URI, so this exercises SSO-3080: the hub matches it
          // port-agnostically (RFC 8252 §7.3, mirroring the sign-in redirect_uri), ends the hub session
          // that the id_token_hint proves, and redirects the browser to the RP's real ported listener.
          // Landing on the RP home (its public "Sign in with Thoryn" affordance) — rather than a hub
          // invalid_request page — is the end-to-end proof the round-trip completed.
          //
          // NOTE: whether a *subsequent* sign-in re-prompts is governed by the upstream identity SSO
          // session lifetime, which RP-Initiated Logout at the hub does not terminate; that is a
          // separate concern and deliberately not asserted here.
          await page.getByRole("link", { name: /sign out/i }).click();
          await expect(
            page.getByRole("link", { name: /sign in with thoryn/i }),
            "after RP-Initiated Logout the browser lands back on the RP home (post_logout_redirect_uri honoured)",
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            page.getByText(/you are signed in as/i),
            "the RP no longer renders the signed-in view",
          ).toHaveCount(0);
        });
      } finally {
        await context.close();
      }
    },
  );

  test(
    "negative security: a wrong password and an unknown email show the SAME neutral error (no user enumeration, SSO-1895)",
    async ({ browser, request }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const knownEmail = uniqueEmail();
      const unknownEmail = uniqueEmail(); // never registered
      try {
        await registerAndVerify(page, request, knownEmail);

        let knownError = "";
        await test.step("A WRONG password on a registered account shows the neutral 'invalid' error", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          await submitLoginWith(page, knownEmail, "definitely-the-wrong-password");
          await expect(
            page.locator("#loginError"),
            "a rejected credential shows the login error banner and never reaches /protected",
          ).toBeVisible();
          await expect(page.getByText(/you are signed in as/i)).toHaveCount(0);
          knownError = (await page.locator("#loginError").innerText()).trim();
          expect(knownError.length, "the error banner carries copy").toBeGreaterThan(0);
        });

        await test.step("An UNKNOWN email shows the IDENTICAL error — no user-existence oracle", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          await submitLoginWith(page, unknownEmail, "any-password-at-all");
          await expect(page.locator("#loginError")).toBeVisible();
          const unknownError = (await page.locator("#loginError").innerText()).trim();
          expect(
            unknownError,
            "an unknown email yields the byte-identical error a wrong password does — the SSO-1895 no-enumeration invariant",
          ).toBe(knownError);
        });
      } finally {
        await context.close();
      }
    },
  );

  test(
    "negative security: a suspended account shows the distinct suspended notice, not the generic error (SSO-3081)",
    async ({ browser, request }) => {
      test.setTimeout(180_000);
      // Needs the `thoryn users suspend` surface (SSO-3081) wired via the CLI env (CI only). Locally,
      // where the CLI jar / API key aren't configured, this negative case is skipped — the rest of the
      // suite is unaffected.
      test.skip(
        !userAdminConfigured(config),
        "suspended-login case needs THORYN_JAR + THORYN_API_KEY + THORYN_ISSUER + THORYN_WORKSPACE_SLUG (CI only)",
      );
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const email = uniqueEmail();
      try {
        await registerAndVerify(page, request, email);

        let genericError = "";
        await test.step("Baseline: a WRONG password on the (still active) account shows the generic invalid error", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          await submitLoginWith(page, email, "definitely-the-wrong-password");
          await expect(page.locator("#loginError")).toBeVisible();
          genericError = (await page.locator("#loginError").innerText()).trim();
          expect(genericError.length).toBeGreaterThan(0);
        });

        await test.step("Suspend the user through the supported `thoryn users suspend` surface", async () => {
          const tokenFile = await loginForUserAdmin(config);
          // The self-service user is only just mirrored into the product-api directory, so the
          // email→id lookup can lag: retry ONLY that ("no user with email"). Any other failure
          // (a scope 403, a confirm 422, …) is surfaced immediately with the CLI's stderr.
          let lastError: unknown = null;
          for (let attempt = 0; attempt < 10; attempt += 1) {
            try {
              await suspendUserByEmail(config, tokenFile, email);
              lastError = null;
              break;
            } catch (e) {
              lastError = e;
              if (!/no user with email/i.test(String((e as Error).message))) throw e;
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
          if (lastError) {
            const dump = await listUsersDiagnostic(config, tokenFile);
            throw new Error(`${(lastError as Error).message}\n[diagnostic] thoryn users list →\n${dump}`);
          }
        });

        await test.step("The suspended account's sign-in shows the DISTINCT suspended notice", async () => {
          await startSignInFromRp(page);
          await expect(page.locator("#passwordForm")).toBeVisible();
          // The CORRECT password: the account-status check fires BEFORE the credential check, so the
          // rejection is the suspension — not a bad password.
          await submitLogin(page, email);
          await expect(
            page.locator("#loginError"),
            "a suspended account is refused at sign-in",
          ).toBeVisible();
          await expect(page.getByText(/you are signed in as/i)).toHaveCount(0);
          const suspendedError = (await page.locator("#loginError").innerText()).trim();
          expect(
            suspendedError,
            "the suspended notice is DISTINCT from the generic invalid-credentials error (SSO-63)",
          ).not.toBe(genericError);
          expect(
            suspendedError.toLowerCase(),
            "the suspended notice names the suspension",
          ).toContain("suspend");
        });
      } finally {
        await context.close();
      }
    },
  );

  test(
    "session management: an app can sign out another device via the CIAM session API (SSO-888/SSO-3083)",
    async ({ browser, request }) => {
      test.setTimeout(180_000);
      // Two devices (browser contexts) sign in as the SAME user. Session management is a BEARER
      // app-integration API (identity /api/v1/me/sessions, no hosted UI): the app's backend calls it
      // with the user's access token. The loopback RP exposes that as GET /sessions + POST
      // /sessions/revoke?id=… (SSO-3083). We assert device A can list both devices' sessions and sign
      // device B out — B's session disappears from the account. Complements the RP-Initiated Logout
      // test (which ends the CURRENT session); this ends ANOTHER device's.
      const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
      const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const email = uniqueEmail();

      // GET the RP's session proxy from a page already on the RP origin (its `sid` cookie rides along;
      // the RP swaps it for the user's bearer server-side). Returns the raw identity session array.
      const listSessions = (page: Page) =>
        page.evaluate(async () => {
          const res = await fetch("/sessions", { headers: { Accept: "application/json" } });
          const body = await res.json().catch(() => null);
          return { status: res.status, list: Array.isArray(body) ? (body as Array<{ id: string; currentDevice: boolean }>) : [] };
        });

      try {
        await registerAndVerify(pageA, request, email);

        await test.step("Both devices sign in and register their session with the CIAM (via the RP /sessions proxy)", async () => {
          for (const page of [pageA, pageB]) {
            await startSignInFromRp(page);
            await expect(page.locator("#passwordForm")).toBeVisible();
            await submitLogin(page, email);
            await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
            // First call records this device's session on the bearer chain (UserSessionTrackingFilter).
            const seen = await listSessions(page);
            expect(seen.status, "the app can read the user's sessions with its access token").toBe(200);
          }
        });

        let otherSessionId = "";
        await test.step("Device A sees BOTH sessions — exactly one is its own (current) device", async () => {
          const seen = await listSessions(pageA);
          expect(seen.status).toBe(200);
          expect(seen.list.length, "both devices' sessions are listed").toBeGreaterThanOrEqual(2);
          expect(seen.list.filter((s) => s.currentDevice).length, "exactly one entry is device A itself").toBe(1);
          otherSessionId = seen.list.find((s) => !s.currentDevice)?.id ?? "";
          expect(otherSessionId, "device B's session id is resolvable").toBeTruthy();
        });

        await test.step("Device A signs device B out, and B's session disappears from the account", async () => {
          const revoke = await pageA.evaluate(async (id) => {
            const res = await fetch(`/sessions/revoke?id=${encodeURIComponent(id)}`, { method: "POST" });
            return res.status;
          }, otherSessionId);
          expect(revoke < 300, `revoking another device's session should 2xx (got ${revoke})`).toBeTruthy();

          // The revoked row is gone — device A now sees only its own session.
          const after = await listSessions(pageA);
          expect(after.status).toBe(200);
          expect(after.list.some((s) => s.id === otherSessionId), "the signed-out device is no longer listed").toBe(false);
          expect(after.list.filter((s) => s.currentDevice).length, "device A's own session survives").toBe(1);
        });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    },
  );

  test("error path: a garbage verify-email token shows the neutral invalid screen", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto(`${config.identityBaseUrl}/verify-email?token=garbage-not-a-real-token`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: /this link is invalid/i }),
        "an unknown/garbage token yields the neutral invalid screen",
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
