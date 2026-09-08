/**
 * SSO-2909 — the simple-signin example, driven end-to-end in a real browser against
 * the STAGING SaaS, INCLUDING a genuinely-sent verification email captured from an
 * EPHEMERAL, in-job Mailpit sink. This is Path B (real self-service sign-up +
 * email capture): a brand-new end user registers on the provisioned workspace, which
 * makes identity SEND a verification email over the tenant's BYO-SMTP (pointed at a
 * public TCP tunnel to the in-job Mailpit by the workflow; the harness reads it back
 * on localhost). The recipe's own identity.registerUser step pre-verifies
 * WITHOUT an email — that is a convenience for the conformance run, not this path.
 *
 *   1. Open the REAL loopback RP (recipes/simple-signin/apps/loopback-rp/server.js):
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
import { test, expect, type Page } from "@playwright/test";
import { config } from "../lib/config";
import { findVerificationLink } from "../lib/mailbox";

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
  await page.locator("#passwordEmail").fill(email);
  await page.locator("#password").fill(config.password);
  await page.locator("#passwordForm button[type=submit]").click();
}

test.describe("simple-signin example — self-service sign-up → verify email → sign in via the loopback RP (SSO-2909)", () => {
  test("full Path-B journey signs a verified user in to the RP's protected page", async ({
    browser,
    request,
  }) => {
    // RP round-trip + real email delivery + Mailpit polling + two hosted form legs.
    test.setTimeout(180_000);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = uniqueEmail();

    try {
      // 1) RP → "Sign in with Thoryn" → the workspace hub → the hosted login form.
      await startSignInFromRp(page);
      await expect(
        page.locator("#passwordForm"),
        "the RP sign-in reaches the identity hosted login via the workspace hub",
      ).toBeVisible();

      // 2) Follow the self-service sign-up path and register a brand-new end user.
      await gotoRegisterFromLogin(page); // LIVE-CONFIRM (a)
      await submitRegistration(page, email);
      await expect(
        page.getByRole("heading", { name: /check your email/i }),
        "self-service sign-up hands off to the verify-email screen",
      ).toBeVisible();

      // 3) Capture the REAL verification email from Mailpit (SMTP-delivered by
      //    identity through the tenant's BYO-SMTP). LIVE-CONFIRM (b).
      let verifyLink: string | null = null;
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

      // 4) Follow the real link → branded "verified" success (token consumed server-side).
      await page.goto(verifyLink!, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: /your email is verified/i }),
        "the captured verification link verifies the email",
      ).toBeVisible();

      // 5) Return to the RP and complete the OIDC login with the verified creds.
      //    LIVE-CONFIRM (c): the account just verified on the tenant's identity
      //    authenticates through the workspace hub federation and back to the RP.
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
