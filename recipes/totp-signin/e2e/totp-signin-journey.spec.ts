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
 * SSO-3380: every identity path here is resolved UNDER identity's context root, read from the hosted
 * page's own `<meta name="_ctx">` (e2e/lib/identity-base.mjs) — since the SSO-3289 cutover identity is
 * mounted at `/id` on the workspace auth host, whose root `/` is the HUB.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — FIRST-LIVE-CONFIRM seams (validated on the first live run, like the   │
 * │ original sandbox-signin): (a) the self-service MFA enrol API base + path          │
 * │ (identity base + mfa/totp/enroll) and whether it needs the               │
 * │ XSRF double-submit header (handled defensively below); (b) that a TOTP-enrolled   │
 * │ user is challenged at /mfa/totp/challenge on a fresh sign-in. If a seam differs,   │
 * │ RECORD the real shape — do not fake a pass.                                       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { totp, secretFromOtpauth } from "../../../e2e/lib/totp.mjs";
import { identityBaseFrom, identityUrl } from "../../../e2e/lib/identity-base.mjs";
import { STEPS } from "./scenario.mjs";


/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/**
 * Fill + submit the hosted password form (identity login.html #passwordForm) and return the IDENTITY
 * BASE URL the form is served from (its context root, trailing slash). A workspace user's hosted login
 * (and its session) lives on the per-workspace auth host (`{slug}.auth.<domain>`, identity mounted at
 * `/id` — SSO-3289), NOT the S2S `identity.stg.thoryn.org` — so the self-service enrol later must
 * target THIS base, read here from the live page's `_ctx` meta rather than assumed from config or taken
 * as the bare origin (whose root is the hub — SSO-3380).
 */
async function submitPassword(page: Page, email: string): Promise<string> {
  await expect(page.locator("#passwordForm")).toBeVisible({ timeout: 30_000 });
  const identityBase = await identityBaseFrom(page);
  await page.locator("#passwordEmail").fill(email);
  await page.locator("#password").fill(config.password);
  await page.locator("#passwordForm button[type=submit]").click();
  return identityBase;
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
async function enrollTotp(page: Page, identityBase: string): Promise<string> {
  // SSO-3049 (fixed): the hub-FEDERATED session from the first sign-in now authorizes the
  // self-service account portal — identity resolves the user by the authenticated principal's
  // users.id PK, not a request-env lookup, so a sandbox user is no longer bounced to /login. Load
  // /account/security to obtain the session _csrf meta, then fetch the enrol endpoints IN THE PAGE
  // (mirroring account-security.js) so the session cookie + CSRF header ride along same-origin.
  await page.goto(identityUrl(identityBase, "account/security"), { waitUntil: "domcontentloaded" });
  expect(
    new URL(page.url()).pathname,
    "the federated session authorizes the account portal (SSO-3049)",
  ).toContain("/account/security");

  // Enrol — in-page fetch, mirroring account-security.js (read the _csrf meta, send it as the header;
  // the endpoint is resolved under the page's own context root, as its `window.__ctx + ...` does).
  const enrollUrl = identityUrl(await identityBaseFrom(page), "mfa/totp/enroll");
  const enroll = await page.evaluate(async (enrollUrl) => {
    const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
    const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
    const res = await fetch(enrollUrl, { method: "POST", headers: { [hdr]: token } });
    return { status: res.status, body: res.ok ? await res.json() : null };
  }, enrollUrl);
  expect(enroll.status < 300, `TOTP enrol should return 2xx (got ${enroll.status})`).toBeTruthy();
  const b = (enroll.body ?? {}) as { secret?: string; qrCodeUri?: string };
  const secret = secretFromOtpauth(b.secret) ?? secretFromOtpauth(b.qrCodeUri);
  expect(secret, "the enrol response carries a base32 secret (or an otpauth qrCodeUri)").toBeTruthy();

  // Verify enrolment with a fresh code (same session → the server's pending secret is bound to it).
  const code = totp(secret!);
  const verifyUrl = identityUrl(await identityBaseFrom(page), "mfa/totp/enroll/verify");
  const verifyStatus = await page.evaluate(async ({ code, verifyUrl }) => {
    const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
    const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
    const res = await fetch(verifyUrl, {
      method: "POST",
      headers: { [hdr]: token, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return res.status;
  }, { code, verifyUrl });
  expect(verifyStatus < 300, `TOTP enrol verify should return 2xx (got ${verifyStatus})`).toBeTruthy();
  return secret!;
}

/**
 * Submit a TOTP code to the hosted challenge exactly as mfa-challenge.html's inline submit handler
 * does: an in-page POST /mfa/totp/verify {code, trustDevice:false}. Returns the status + parsed body
 * ({redirect} on success, {error,...} on rejection). Driving the endpoint via the page's own fetch
 * exercises the identical request + resume redirect the "Verify" button triggers, without depending
 * on the form-submit EVENT firing under headless Playwright (it does not reliably here).
 */
async function verifyTotpChallenge(
  page: Page,
  code: string,
): Promise<{ status: number; data: { redirect?: string; error?: string } }> {
  const verifyUrl = identityUrl(await identityBaseFrom(page), "mfa/totp/verify");
  return page.evaluate(async ({ code, verifyUrl }) => {
    // SSO-3052: /mfa/totp/verify is CSRF-protected; send the session token from the _csrf meta, as
    // mfa-challenge.html's own handler now does.
    const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
    const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers[hdr] = token;
    const res = await fetch(verifyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ code, trustDevice: false }),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }, { code, verifyUrl });
}

/**
 * Disable MFA from the hosted account page exactly as account/security.html's own handler does: an
 * in-page POST /account/mfa/disable {currentPassword, verificationCode} on the session chain (CSRF via
 * the rendered _csrf meta). Disabling is re-auth-gated — it proves BOTH knowledge (the password) and
 * possession (a live TOTP code) — so the caller passes the current authenticator [code]. Returns the
 * status + parsed body ({message} on success).
 */
async function disableMfaViaAccountPage(
  page: Page,
  identityBase: string,
  password: string,
  code: string,
): Promise<{ status: number; data: { message?: string; error?: string } }> {
  await page.goto(identityUrl(identityBase, "account/security"), { waitUntil: "domcontentloaded" });
  expect(
    new URL(page.url()).pathname,
    "the federated session authorizes the account portal (SSO-3049)",
  ).toContain("/account/security");
  const disableUrl = identityUrl(await identityBaseFrom(page), "account/mfa/disable");
  return page.evaluate(
    async ({ password, code, disableUrl }) => {
      const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
      const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers[hdr] = token;
      const res = await fetch(disableUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ currentPassword: password, verificationCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    },
    { password, code, disableUrl },
  );
}

test.describe("totp-signin example — enrol a TOTP authenticator, then a fresh sign-in is challenged for the second factor (SSO-3043)", () => {
  // Shared across the serial (workers:1) tests: the base32 secret the full-journey test enrols, so the
  // later MFA-lifecycle test can compute a live code to disable the same standing user's authenticator.
  let enrolledSecret = "";
  test("full journey: password sign-in → enrol TOTP → re-sign-in is TOTP-challenged → /protected", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "totp-signin"}@example.com`;

    try {
      // 1) First sign-in with the password only (the user has no second factor yet).
      let identityBase = "";
      await test.step(STEPS.firstSignin, async () => {
        await startSignInFromRp(page);
        identityBase = await submitPassword(page, email);
        await expect(
          page.getByText(/you are signed in as/i),
          "the first (password-only) sign-in reaches the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
      });

      // 2) Enrol a TOTP authenticator for the now-signed-in user (self-service MFA API).
      let secret = "";
      await test.step(STEPS.enroll, async () => {
        secret = await enrollTotp(page, identityBase);
        enrolledSecret = secret; // share with the MFA-lifecycle (disable) test below
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
        // Verify the challenge as the page's handler does (in-page POST /mfa/totp/verify), then follow
        // the resume redirect it returns — the same request + redirect the Verify button triggers.
        const challenge = await verifyTotpChallenge(page, totp(secret));
        expect(
          challenge.status < 300,
          `TOTP challenge verify should 2xx (got ${challenge.status}) ${JSON.stringify(challenge.data)}`,
        ).toBeTruthy();
        expect(challenge.data.redirect, "a correct TOTP returns the OAuth resume redirect").toBeTruthy();
        await page.goto(challenge.data.redirect!, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByText(/you are signed in as/i),
          "following the resume redirect reaches the RP protected page",
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
      // The full-journey test above already enrolled TOTP for this per-run user (the recipe
      // provisions ONE user and this file runs serially, workers:1), and enrolment is server-side,
      // so a fresh sign-in here is challenged for the second factor. Sign in, then enter a bad code.
      await startSignInFromRp(page);
      await submitPassword(page, email);
      await expect(
        page.locator("#mfa-form #code"),
        "the TOTP-enrolled user is challenged for the second factor on sign-in",
      ).toBeVisible({ timeout: 30_000 });
      const rejected = await verifyTotpChallenge(page, "000000");
      expect(
        rejected.status >= 400 || !!rejected.data.error,
        `a wrong TOTP code is rejected (status ${rejected.status}, ${JSON.stringify(rejected.data)})`,
      ).toBeTruthy();
      expect(rejected.data.redirect, "a wrong code does NOT return a resume redirect").toBeFalsy();
      await expect(page.getByText(/you are signed in as/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // Runs while MFA is still enrolled (before the disable test below): regenerate the account's
  // recovery (backup) codes on the hosted account page and assert a fresh, distinct set is issued.
  test("recovery codes: a signed-in user regenerates their backup codes on the account page (5 fresh, distinct codes)", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    test.skip(!enrolledSecret, "depends on the full-journey test having enrolled TOTP (shares its secret)");
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "totp-signin"}@example.com`;

    try {
      let identityBase = "";
      await test.step("Sign in (password + TOTP challenge) to reach the account portal", async () => {
        await startSignInFromRp(page);
        identityBase = await submitPassword(page, email);
        await expect(page.locator("#mfa-form #code")).toBeVisible({ timeout: 30_000 });
        const challenge = await verifyTotpChallenge(page, totp(enrolledSecret));
        expect(challenge.status < 300 && !!challenge.data.redirect, `TOTP challenge should 2xx (got ${challenge.status})`).toBeTruthy();
        await page.goto(challenge.data.redirect!, { waitUntil: "domcontentloaded" });
        await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
      });

      await test.step("Regenerate recovery codes on /account/security — a fresh set of 5, distinct from the previous set", async () => {
        await page.goto(identityUrl(identityBase, "account/security"), { waitUntil: "domcontentloaded" });
        expect(new URL(page.url()).pathname, "the federated session authorizes the account portal (SSO-3049)").toContain(
          "/account/security",
        );
        const regenUrl = identityUrl(await identityBaseFrom(page), "account/recovery-codes/regenerate");
        const regen = async () =>
          page.evaluate(async (regenUrl) => {
            const token = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
            const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers[hdr] = token;
            const res = await fetch(regenUrl, { method: "POST", headers });
            return { status: res.status, body: res.ok ? ((await res.json()) as { codes?: string[] }) : null };
          }, regenUrl);

        const first = await regen();
        expect(first.status, "regenerate returns 200").toBe(200);
        expect(first.body?.codes?.length, "a fresh set of 5 recovery codes is issued").toBe(5);

        // Regenerating again REVOKES the previous set and issues a new one — the codes must differ.
        const second = await regen();
        expect(second.status).toBe(200);
        expect(second.body?.codes?.length).toBe(5);
        const overlap = (second.body!.codes ?? []).filter((c) => (first.body!.codes ?? []).includes(c));
        expect(overlap.length, "regeneration rotates the codes — no code carries over from the previous set").toBe(0);
      });
    } finally {
      await context.close();
    }
  });

  // Runs LAST (serial, workers:1): it turns MFA OFF for the standing user, so it must come after the
  // tests above that rely on the second-factor challenge being active.
  test("MFA lifecycle: disabling MFA on the account page means the next sign-in is no longer second-factor challenged", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    test.skip(!enrolledSecret, "depends on the full-journey test having enrolled TOTP (shares its secret)");
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "totp-signin"}@example.com`;

    try {
      let identityBase = "";
      await test.step("Sign in (password + TOTP challenge) to reach the account portal", async () => {
        await startSignInFromRp(page);
        identityBase = await submitPassword(page, email);
        await expect(page.locator("#mfa-form #code")).toBeVisible({ timeout: 30_000 });
        const challenge = await verifyTotpChallenge(page, totp(enrolledSecret));
        expect(
          challenge.status < 300 && !!challenge.data.redirect,
          `TOTP challenge should 2xx with a resume redirect (got ${challenge.status})`,
        ).toBeTruthy();
        await page.goto(challenge.data.redirect!, { waitUntil: "domcontentloaded" });
        await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
      });

      await test.step("Disable MFA on the hosted /account/security page (re-auth: current password + live TOTP code)", async () => {
        const result = await disableMfaViaAccountPage(page, identityBase, config.password, totp(enrolledSecret));
        expect(
          result.status === 200,
          `disable MFA should 200 (got ${result.status}: ${JSON.stringify(result.data)})`,
        ).toBeTruthy();
        expect(String(result.data.message ?? "").toLowerCase(), "the disable confirmation names the outcome").toContain("disabled");
      });

      await test.step("A fresh sign-in is now PASSWORD-ONLY — no second-factor challenge", async () => {
        await context.clearCookies();
        await startSignInFromRp(page);
        await submitPassword(page, email);
        // With MFA disabled, the password sign-in resumes straight to the RP protected page; the TOTP
        // challenge screen must never appear.
        await expect(
          page.getByText(/you are signed in as/i),
          "after disabling MFA the password-only sign-in reaches /protected directly",
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          page.locator("#mfa-form #code"),
          "no second-factor challenge is shown once MFA is disabled",
        ).toHaveCount(0);
      });
    } finally {
      await context.close();
    }
  });
});
