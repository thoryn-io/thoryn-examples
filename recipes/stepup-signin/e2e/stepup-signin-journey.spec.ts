/**
 * SSO-3044 (epic SSO-3042) — the `stepup-signin` example, driven end-to-end in a real browser against
 * the STAGING SaaS. It is `sandbox-signin` plus ONE added concept: RE-AUTHENTICATION for a sensitive
 * action. A verified user signs in normally; then the relying party starts a second authorize with
 * OIDC `prompt=login` (RFC 9470 step-up), and the user is CHALLENGED to authenticate AGAIN even though
 * the session is still active — the hub honours `prompt=login` end to end (SSO-3071) and re-drives the
 * identity login. A plain re-authorize (no `prompt=login`) rides the existing session silently, which
 * is exactly what makes the step-up observable.
 *
 * No new product configuration and no step-up-specific scope: `prompt=login` is a standard OIDC
 * authorize parameter the RP sends, so the whole behaviour lives here + in the loopback RP's
 * `/step-up` "sensitive action" route.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — FIRST-LIVE-CONFIRM seams (validated on the first live run): a `prompt=login` │
 * │ authorize re-challenges the active session at the hosted login form, and the step-up    │
 * │ genuinely re-verifies credentials (a wrong password is rejected). Confirmed on local k3d │
 * │ (default plane) after the SSO-3071 hub fix. If a seam differs on staging, RECORD it.     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { STEPS } from "./scenario.mjs";

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

/** Read the `auth_time` claim rendered on the RP's /protected page (the claims table), or null. */
async function readAuthTime(page: Page): Promise<number | null> {
  const cell = page.locator("tr", { has: page.locator("td", { hasText: /^auth_time$/ }) }).locator("td").nth(1);
  const raw = (await cell.textContent().catch(() => null))?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

test.describe("stepup-signin example — a sensitive action forces a fresh re-authentication via OIDC prompt=login (SSO-3044)", () => {
  test("full journey: sign in → sensitive action (prompt=login) → RE-CHALLENGED → re-auth → /protected", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "stepup-signin"}@example.com`;

    try {
      // 1) A normal sign-in — the user now has an active session at the hub.
      let authTime1: number | null = null;
      await test.step(STEPS.firstSignin, async () => {
        await startSignInFromRp(page);
        await submitPassword(page, email);
        await expect(
          page.getByText(/you are signed in as/i),
          "the initial sign-in reaches the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
        authTime1 = await readAuthTime(page);
      });

      // 2) The SENSITIVE ACTION: the RP starts a second authorize with prompt=login. Even though the
      //    session is active, the hosted login form must reappear — the hub forces a fresh auth.
      await test.step(STEPS.stepUp, async () => {
        await page.getByRole("link", { name: /perform a sensitive action/i }).click();
        await expect(
          page.locator("#passwordForm"),
          "prompt=login re-challenges the active session at the hosted login form (RFC 9470 step-up)",
        ).toBeVisible({ timeout: 30_000 });
      });

      // 3) Re-authenticate → back on /protected with an auth_time that is not older than before.
      await test.step(STEPS.reauth, async () => {
        await submitPassword(page, email);
        await expect(
          page.getByText(/you are signed in as/i),
          "after re-authenticating, the sensitive action completes on the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
        const authTime2 = await readAuthTime(page);
        if (authTime1 != null && authTime2 != null) {
          expect(authTime2, "the re-authentication produced a fresh (>=) auth_time").toBeGreaterThanOrEqual(authTime1);
        }
      });
    } finally {
      await context.close();
    }
  });

  test("error path: a wrong password at the step-up re-authentication is rejected", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "stepup-signin"}@example.com`;
    try {
      // Sign in, then trigger the sensitive action so the step-up re-challenge appears.
      await startSignInFromRp(page);
      await submitPassword(page, email);
      await expect(page.getByText(/you are signed in as/i)).toBeVisible({ timeout: 30_000 });
      await page.getByRole("link", { name: /perform a sensitive action/i }).click();
      await expect(page.locator("#passwordForm")).toBeVisible({ timeout: 30_000 });

      // The step-up genuinely RE-VERIFIES credentials: a wrong password is rejected and the sensitive
      // action does not complete — proving the re-auth is a real credential check, not just a form.
      await page.locator("#passwordEmail").fill(email);
      await page.locator("#password").fill("Wrong-Password-999!");
      await page.locator("#passwordForm button[type=submit]").click();
      await expect(
        page.locator("#loginError"),
        "a wrong password at the step-up re-auth is rejected",
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/you are signed in as/i), "the sensitive action does not complete").toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
