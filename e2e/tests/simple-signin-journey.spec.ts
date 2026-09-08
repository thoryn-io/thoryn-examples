/**
 * SSO-2909 — the simple-signin example, driven end-to-end in a real browser against
 * the deployed browsable stack, INCLUDING a genuinely-sent verification email
 * captured from Mailpit. This is Path B (email capture): the sign-up is a real
 * self-service registration that makes identity SEND a verification email (the
 * recipe's identity.registerUser pre-verifies with no email — a convenience, not
 * this path).
 *
 *   1. Self-service sign-up on identity /register → "check your email" hand-off.
 *   2. Poll Mailpit until the verification email to THIS address lands; extract the
 *      real `<identity>/verify-email?token=…` link from its body.
 *   3. Follow the link → branded "verified" success (single-use token consumed).
 *   4. Drive the REAL loopback RP (recipes/simple-signin/apps/loopback-rp/server.js):
 *      GET / → "Sign in with Thoryn" → RP 302s to {workspace-issuer}/oauth2/authorize
 *      → hub federates to identity → sign in with the registered creds → callback →
 *      RP /protected renders the ID-token claims. Assert we are signed in.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — never run against a live cluster. See docs/ci-e2e-plan.md.        │
 * │ Selectors mirror oathy e2e/scenario/tests/hosted-signup-to-console.spec.ts,  │
 * │ but the endpoints (workspace-issuer, loopback RP) and the LANDING assertion  │
 * │ (RP /protected, not the console) are the example's own. The identity form    │
 * │ selectors + the cross-tenant account-reuse assumption (step 4) must be        │
 * │ CONFIRMED on the first live run — see docs/ci-e2e-plan.md §7 item 11.         │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page } from "@playwright/test";
import { config } from "../lib/config";
import { findVerificationLink } from "../lib/mailpit";

/** Unique per run so reruns never 409 and the Mailpit match is unambiguous. */
function uniqueEmail(): string {
  return `example-signin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@thoryn.test`;
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
  await page.locator("#passwordEmail").fill(email);
  await page.locator("#password").fill(config.password);
  await page.locator("#passwordForm button[type=submit]").click();
}

test.describe("simple-signin example — sign-up → verify email → sign in via the loopback RP (SSO-2909)", () => {
  test("full Path-B journey signs a verified user in to the RP's protected page", async ({
    browser,
    request,
  }) => {
    // Registration + real email delivery + Mailpit polling + the RP OIDC round-trip.
    test.setTimeout(180_000);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = uniqueEmail();

    try {
      // 1) Self-service sign-up → "Check your email" hand-off.
      await page.goto(`${config.identityBaseUrl}/register`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#registerForm")).toBeVisible();
      await submitRegistration(page, email);
      await expect(
        page.getByRole("heading", { name: /check your email/i }),
        "self-service sign-up hands off to the verify-email screen",
      ).toBeVisible();

      // 2) Capture the REAL verification email from Mailpit (SMTP-delivered by identity).
      let verifyLink: string | null = null;
      await expect
        .poll(
          async () => {
            verifyLink = await findVerificationLink(request, config.mailpitBaseUrl, email);
            return verifyLink;
          },
          {
            message: `verification email to ${email} captured from Mailpit (${config.mailpitBaseUrl})`,
            timeout: 45_000,
            intervals: [500, 1000, 2000, 3000],
          },
        )
        .not.toBeNull();
      expect(verifyLink!, "verification link points at the identity verify-email landing").toContain(
        "/verify-email?token=",
      );

      // 3) Follow the real link → branded "verified" success (token consumed server-side).
      await page.goto(verifyLink!, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: /your email is verified/i }),
        "the captured verification link verifies the email",
      ).toBeVisible();

      // 4) Drive the REAL loopback RP → hub → identity login → callback → /protected.
      //    OPEN QUESTION (docs/ci-e2e-plan.md §7 item 11): the account was created on
      //    the default-tenant identity host; whether it can authenticate through the
      //    WORKSPACE tenant's hub federation is unverified. If it can't, the sign-up
      //    must move to the workspace tenant's own /register surface.
      await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.getByRole("link", { name: /sign in with thoryn/i }).click();

      // The hub federates to identity → the login form renders for this fresh user.
      await expect(
        page.locator("#passwordForm"),
        "the RP sign-in reaches the identity login form via the workspace hub",
      ).toBeVisible();
      await submitLogin(page, email);

      // Back on the loopback RP's protected page, signed in.
      await expect(
        page.getByText(/you are signed in as/i),
        "the OIDC code flow completes and the RP renders its protected page",
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(email, { exact: false })).toBeVisible();
    } finally {
      await context.close();
    }
  });

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
