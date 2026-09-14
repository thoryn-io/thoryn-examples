/**
 * SSO-2595 (epic SSO-3042) — the `magic-code-signin` example, driven end-to-end in a real browser
 * against the STAGING SaaS. Passwordless sign-in with a 6-digit email OTP: the user requests a code
 * on the hosted login, the code is captured from the per-run SANDBOX test-inbox (SSO-3074), typed
 * back on the login page, and the OAuth flow resumes to the RP protected page.
 *
 * Magic-code is OPT-IN (not in the default method set), so the journey first ENABLES it for the
 * sandbox with `thoryn login-methods set --environment <slug> …` (SSO-3075) — a supported CLI action,
 * not a raw API call. Per-environment enforcement (SSO-3073) makes the sandbox login offer magic-code
 * without touching production.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — FIRST-LIVE-CONFIRM seams (validated on the first live run): (a) `thoryn   │
 * │ login-methods set --method magic_code` makes the sandbox login render the #magicCode  │
 * │ affordance (needs SSO-3073 env-scoped enforcement live); (b) the sandbox test-inbox    │
 * │ captures the code on channel `magic_code` (needs SSO-3074 live); (c) the hosted        │
 * │ /auth/magic-code request+verify selectors. If a seam differs, RECORD it — never fake.  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../../e2e/lib/config";
import { findMagicCodeViaInbox } from "../../../e2e/lib/test-inbox.mjs";
import { STEPS } from "./scenario.mjs";

const execFileP = promisify(execFile);

/** Enable magic-code for the per-run sandbox via the supported CLI action (SSO-3075). */
async function enableMagicCode(): Promise<void> {
  const jar = config.cli.jarPath;
  const envSlug = config.cli.envSlug;
  expect(jar, "magic-code needs THORYN_JAR (the CLI the workflow signed in)").toBeTruthy();
  expect(envSlug, "magic-code needs SANDBOX_ENV_SLUG (the per-run sandbox)").toBeTruthy();
  // --environment rides X-Thoryn-Environment so the client-credentials CI session targets the sandbox
  // (SSO-3068). Set the FULL allow-list (PUT replaces) — keep password + magic_link + add magic_code.
  await execFileP(
    "java",
    [
      "-jar", jar, "login-methods", "set",
      "--environment", envSlug,
      "--method", "password",
      "--method", "magic_link",
      "--method", "magic_code",
    ],
    { timeout: 60_000 },
  );
}

/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/** Reveal the magic-code affordance on the hosted login, enter the email, and request the code. */
async function requestMagicCode(page: Page, email: string): Promise<void> {
  await expect(page.locator("#magicCodeToggle")).toBeVisible({ timeout: 30_000 });
  await page.locator("#magicCodeToggle").click();
  await page.locator("#magicCodeEmail").fill(email);
  await page.locator("#magicCodeRequestForm button[type=submit]").click();
  // On 202 the page reveals the code-entry form.
  await expect(page.locator("#magicCodeVerifyForm")).toBeVisible({ timeout: 30_000 });
}

/** Poll the sandbox test-inbox for the captured 6-digit code. */
async function captureMagicCode(email: string): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(async () => (code = await findMagicCodeViaInbox(config.cli, email)), {
      message: "the sandbox test-inbox captures the magic-code on channel magic_code",
      timeout: 60_000,
    })
    .toBeTruthy();
  return code!;
}

test.describe("magic-code-signin example — passwordless sign-in with a 6-digit email OTP (SSO-2595)", () => {
  test("full journey: enable magic-code → request a code → type it → /protected", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "magic-code-signin"}@example.com`;

    try {
      await test.step(STEPS.enable, async () => {
        await enableMagicCode();
      });

      await test.step(STEPS.request, async () => {
        await startSignInFromRp(page);
        await requestMagicCode(page, email);
      });

      let code = "";
      await test.step(STEPS.capture, async () => {
        code = await captureMagicCode(email);
        expect(code, "a 6-digit code was captured").toMatch(/^\d{6}$/);
      });

      await test.step(STEPS.verify, async () => {
        await page.locator("#magicCodeInput").fill(code);
        await page.locator("#magicCodeVerifyForm button[type=submit]").click();
        await expect(
          page.getByText(/you are signed in as/i),
          "typing the captured code completes the passwordless sign-in at the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(email, { exact: false }).first()).toBeVisible();
      });
    } finally {
      await context.close();
    }
  });

  test("error path: a wrong code is rejected at the magic-code challenge", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "magic-code-signin"}@example.com`;
    try {
      // magic-code is already enabled by the full journey (same per-run sandbox, serial workers:1).
      await startSignInFromRp(page);
      await requestMagicCode(page, email);
      await page.locator("#magicCodeInput").fill("000000");
      await page.locator("#magicCodeVerifyForm button[type=submit]").click();
      await expect(
        page.locator("#magicCodeError"),
        "a wrong 6-digit code is rejected at the hosted magic-code challenge",
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/you are signed in as/i), "the user is not signed in").toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
