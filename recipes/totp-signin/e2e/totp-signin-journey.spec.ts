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


/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/**
 * Fill + submit the hosted password form (identity login.html #passwordForm) and return the IDENTITY
 * ORIGIN the form is served from. A workspace user's hosted login (and its session) lives on the
 * per-workspace identity host (`{slug}.identity.<domain>`, SSO-2849), NOT the default
 * `identity.stg.thoryn.org` — so the self-service enrol later must target THIS origin, captured here
 * from the live page rather than assumed from config.
 */
async function submitPassword(page: Page, email: string): Promise<string> {
  await expect(page.locator("#passwordForm")).toBeVisible({ timeout: 30_000 });
  const identityOrigin = new URL(page.url()).origin;
  await page.locator("#passwordEmail").fill(email);
  await page.locator("#password").fill(config.password);
  await page.locator("#passwordForm button[type=submit]").click();
  return identityOrigin;
}

/**
 * Enrol TOTP for the signed-in user, returning the base32 secret so the challenge step can compute
 * codes. The self-service MFA enrol/verify endpoints (POST /mfa/totp/enroll[/verify]) live on
 * identity-service's SESSION (form-login) security chain, which is CSRF-protected via the session
 * token RENDERED INTO THE PAGE as <meta name="_csrf"> / <meta name="_csrf_header"> — NOT a cookie,
 * so the XSRF-TOKEN double-submit does not apply. We therefore drive enrolment exactly as the
 * product's own /account/security JS does: load that page (the real enrolment surface, on the
 * session chain) to obtain the _csrf meta, then fetch() the endpoints IN THE PAGE so the session
 * cookie + CSRF header ride along same-origin.
 */
async function enrollTotp(page: Page, identityOrigin: string, email: string): Promise<string> {
  const base = identityOrigin;
  // The hub-FEDERATED session (from the RP sign-in) does NOT authorize the self-service account
  // portal — GET /account/security 302s to /login. Establish a real account-portal (form-login)
  // session by signing in DIRECTLY at identity, mirroring oathy e2e/hosted-login loginViaPassword,
  // then load /account/security (now authenticated) to read its session _csrf meta.
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  if (await page.locator("#passwordForm").isVisible().catch(() => false)) {
    await page.locator("#passwordEmail").fill(email);
    await page.locator("#password").fill(config.password);
    await page.locator("#passwordForm button[type=submit]").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => {});
  }
  await page.goto(`${base}/account/security`, { waitUntil: "domcontentloaded" });
  expect(
    new URL(page.url()).pathname,
    "the account portal must be authenticated to enrol TOTP (direct form-login established a session)",
  ).toContain("/account/security");

  // Enrol — in-page fetch, mirroring account-security.js (read the _csrf meta, send it as the header).
  const enroll = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
    const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
    const res = await fetch("/mfa/totp/enroll", { method: "POST", headers: { [hdr]: token } });
    return { status: res.status, body: res.ok ? await res.json() : null };
  });
  expect(enroll.status < 300, `TOTP enrol should return 2xx (got ${enroll.status})`).toBeTruthy();
  const b = (enroll.body ?? {}) as { secret?: string; qrCodeUri?: string };
  const secret = secretFromOtpauth(b.secret) ?? secretFromOtpauth(b.qrCodeUri);
  expect(secret, "the enrol response carries a base32 secret (or an otpauth qrCodeUri)").toBeTruthy();

  // Verify enrolment with a fresh code (same session → the server's pending secret is bound to it).
  const code = totp(secret!);
  const verifyStatus = await page.evaluate(async (code) => {
    const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
    const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
    const res = await fetch("/mfa/totp/enroll/verify", {
      method: "POST",
      headers: { [hdr]: token, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return res.status;
  }, code);
  expect(verifyStatus < 300, `TOTP enrol verify should return 2xx (got ${verifyStatus})`).toBeTruthy();
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
      let identityOrigin = "";
      await test.step(STEPS.firstSignin, async () => {
        await startSignInFromRp(page);
        identityOrigin = await submitPassword(page, email);
        await expect(
          page.getByText(/you are signed in as/i),
          "the first (password-only) sign-in reaches the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
      });

      // 2) Enrol a TOTP authenticator for the now-signed-in user (self-service MFA API).
      let secret = "";
      await test.step(STEPS.enroll, async () => {
        secret = await enrollTotp(page, identityOrigin, email);
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
      const identityOrigin = await submitPassword(page, email);
      await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
      await enrollTotp(page, identityOrigin, email);

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
