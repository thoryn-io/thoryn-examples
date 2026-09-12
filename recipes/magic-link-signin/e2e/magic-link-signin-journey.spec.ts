/**
 * SSO-3043 (epic SSO-3042) — the `totp-signin` example, driven end-to-end in a real browser against
 * the STAGING SaaS. It is `sandbox-signin` plus ONE added concept: a SECOND FACTOR. A verified user
 * exists in a fresh per-run sandbox; the journey ENROLS a TOTP authenticator for that user, then
 * proves a fresh sign-in is CHALLENGED for the second factor and completes with a computed code.
 *
 * MFA is USER-enrolment-driven: once the user enrols TOTP, every sign-in challenges — so the recipe
 * needs no MFA-specific action, and the whole 2FA behaviour lives here.
 *
 * The code is computed locally with the pure RFC-6238 computer in e2e/lib/totp.mjs — the same
 * algorithm a real authenticator app runs, never faked. Enrolment uses the product's self-service
 * MFA API (`POST /mfa/totp/enroll` → {secret}; `/verify` {code}) AS the signed-in user
 * (the browser holds the identity session after the first sign-in); the challenge uses the hosted
 * /mfa/totp/challenge screen (#mfa-form / #code).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — FIRST-LIVE-CONFIRM seams (validated on the first live run, like the   │
 * │ original sandbox-signin): (a) the self-service MFA enrol API base + path          │
 * │ (config.identityBaseUrl + /mfa/totp/enroll) and whether it needs the     │
 * │ XSRF double-submit header (handled defensively below); (b) that a TOTP-enrolled   │
 * │ user is challenged at /mfa/totp/challenge on a fresh sign-in. If a seam differs,   │
 * │ RECORD the real shape — do not fake a pass.                                       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { totp, secretFromOtpauth } from "../../../e2e/lib/totp.mjs";
import { STEPS } from "./scenario.mjs";

const MFA_ENROLL = "/mfa/totp/enroll";
const MFA_ENROLL_VERIFY = "/mfa/totp/enroll/verify";

/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/** Fill + submit the hosted password form (identity login.html #passwordForm). */
async function submitPassword(page: Page, email: string): Promise<void> {
  await expect(page.locator("#passwordForm")).toBeVisible({ timeout: 30_000 });
  await page.locator("#passwordEmail").fill(email);
  await page.locator("#password").fill(config.password);
  await page.locator("#passwordForm button[type=submit]").click();
}

/** The XSRF double-submit token, if the identity chain set one — sent as the header Spring expects. */
async function xsrfHeader(context: BrowserContext): Promise<Record<string, string>> {
  const cookie = (await context.cookies()).find((c) => c.name === "XSRF-TOKEN");
  return cookie ? { "X-XSRF-TOKEN": cookie.value } : {};
}

/**
 * Enrol TOTP for the signed-in user via the self-service API, and return the base32 secret so the
 * challenge step can compute codes. The browser already holds the identity session (first sign-in),
 * and page.request reuses its cookies; the enrol→verify pair shares one session (the pending secret
 * is session-bound server-side).
 */
async function enrollTotp(page: Page, context: BrowserContext): Promise<string> {
  const base = config.identityBaseUrl;
  // Seed the XSRF cookie (a hosted GET on the identity origin) before the state-changing POSTs.
  await page.goto(`${base}/account/security`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const headers = { "Content-Type": "application/json", ...(await xsrfHeader(context)) };

  const enrollRes = await page.request.post(`${base}${MFA_ENROLL}`, { headers, data: {}, ignoreHTTPSErrors: true });
  expect(enrollRes.ok(), `TOTP enrol should return 2xx (${enrollRes.status()})`).toBeTruthy();
  const body = (await enrollRes.json()) as { secret?: string; qrCodeUri?: string };
  const secret = secretFromOtpauth(body.secret) ?? secretFromOtpauth(body.qrCodeUri);
  expect(secret, "the enrol response carries a base32 secret (or an otpauth qrCodeUri)").toBeTruthy();

  const verifyRes = await page.request.post(`${base}${MFA_ENROLL_VERIFY}`, {
    headers,
    data: { code: totp(secret!) },
    ignoreHTTPSErrors: true,
  });
  expect(verifyRes.ok(), `TOTP enrol verify should return 2xx (${verifyRes.status()})`).toBeTruthy();
  return secret!;
}

test.describe("totp-signin example — enrol a TOTP authenticator, then a fresh sign-in is challenged for the second factor (SSO-3043)", () => {
  test("full journey: password sign-in → enrol TOTP → re-sign-in is TOTP-challenged → /protected", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "totp-signin"}@example.com`;

    try {
      // 1) First sign-in with the password only (the user has no second factor yet).
      await test.step(STEPS.firstSignin, async () => {
        await startSignInFromRp(page);
        await submitPassword(page, email);
        await expect(
          page.getByText(/you are signed in as/i),
          "the first (password-only) sign-in reaches the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
      });

      // 2) Enrol a TOTP authenticator for the now-signed-in user (self-service MFA API).
      let secret = "";
      await test.step(STEPS.enroll, async () => {
        secret = await enrollTotp(page, context);
      });

      // 3) Fresh sign-in → now CHALLENGED for the second factor → computed code → /protected.
      await test.step(STEPS.challenge, async () => {
        await context.clearCookies(); // drop the session so sign-in runs from scratch
        await startSignInFromRp(page);
        await submitPassword(page, email);
        await expect(
          page.locator("#mfa-form #code"),
          "a TOTP-enrolled user is challenged for the second factor on sign-in",
        ).toBeVisible({ timeout: 30_000 });
        await page.locator("#mfa-form #code").fill(totp(secret));
        await page.locator("#mfa-form button[type=submit]").click();
        await expect(
          page.getByText(/you are signed in as/i),
          "the computed TOTP completes the second factor and reaches the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(email, { exact: false }).first()).toBeVisible();
      });
    } finally {
      await context.close();
    }
  });

  test("error path: a wrong TOTP code is rejected at the challenge", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "totp-signin"}@example.com`;
    try {
      // Enrol first (so the account is TOTP-gated), then re-sign-in and enter a bad code.
      await startSignInFromRp(page);
      await submitPassword(page, email);
      await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
      await enrollTotp(page, context);

      await context.clearCookies();
      await startSignInFromRp(page);
      await submitPassword(page, email);
      await expect(page.locator("#mfa-form #code")).toBeVisible({ timeout: 30_000 });
      await page.locator("#mfa-form #code").fill("000000");
      await page.locator("#mfa-form button[type=submit]").click();
      await expect(
        page.locator("#error-message"),
        "a wrong TOTP code surfaces the inline error and does not sign the user in",
      ).toBeVisible();
      await expect(page.getByText(/you are signed in as/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
