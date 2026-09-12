/**
 * SSO-3047 (epic SSO-3046) — `magic-link-signin` browser journey: SAME-DEVICE passwordless sign-in.
 *
 * Drives the recipe's loopback RP against the staging SaaS, pointed at a FRESH per-run SANDBOX
 * ENVIRONMENT. A verified user signs in with NO password: on the hosted login they choose "email me a
 * sign-in link" (identity `POST /auth/magic-link/request`, which also sets the `ML_INIT`
 * initiating-device cookie). In a sandbox the email is suppressed from real SMTP and captured into the
 * per-env test inbox (identity `TestModeEmailGate`, channel `magic_link`; read back via
 * `thoryn env test-emails`). Opening that link IN THE SAME browser context (the matching `ML_INIT`
 * cookie ⇒ same device) authenticates the clicking session and resumes `/oauth2/authorize` → the RP
 * protected page.
 *
 * ┌─ FIRST-LIVE-CONFIRM seams (validated on the first live run) ──────────────────────────────────┐
 * │ (a) the hosted magic-link affordance (#magicLinkToggle → #magicLinkForm → #magicLinkEmail);     │
 * │ (b) the sandbox test-inbox captures the magic-link on channel `magic_link` with the consume     │
 * │     link as its actionLink; (c) opening the link SAME-device authenticates + resumes to /protected.│
 * │ If a seam differs, fix the selector/channel here — do not fake.                                 │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { findMagicLinkViaInbox } from "../../../e2e/lib/test-inbox.mjs";
import { STEPS } from "./scenario.mjs";

/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/** Reveal the magic-link affordance on the hosted login, enter the email, and request the link. */
async function requestMagicLink(page: Page, email: string): Promise<void> {
  await expect(page.locator("#magicLinkToggle")).toBeVisible({ timeout: 30_000 });
  await page.locator("#magicLinkToggle").click();
  await page.locator("#magicLinkEmail").fill(email);
  await page.locator("#magicLinkForm button[type=submit]").click();
  // The hosted page confirms the send (constant-time, no enumeration) in #magicLinkStatus.
  await expect(page.locator("#magicLinkStatus")).toContainText(/sign-in link|check your email|expires/i, {
    timeout: 30_000,
  });
}

/** Poll the sandbox test-inbox for the captured magic-link (the single-use consume URL). */
async function captureMagicLink(email: string): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(async () => (link = await findMagicLinkViaInbox(config.cli, email)), {
      message: "the magic-link email is captured in the sandbox test inbox (channel magic_link)",
      timeout: 60_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    })
    .toBeTruthy();
  return link!;
}

test.describe("magic-link-signin example — passwordless sign-in via a single-use email link on the SAME device (SSO-3047)", () => {
  test("full journey: request a magic link → open it on the same device → /protected", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "magic-link-signin"}@example.com`;

    try {
      // 1) Start the OAuth flow and request a passwordless sign-in link (sets the ML_INIT cookie).
      await test.step(STEPS.request, async () => {
        await startSignInFromRp(page);
        await requestMagicLink(page, email);
      });

      // 2) Capture the link from the sandbox test inbox.
      let link = "";
      await test.step(STEPS.capture, async () => {
        link = await captureMagicLink(email);
      });

      // 3) Open the link ON THE SAME device (this context still carries ML_INIT) → authenticated →
      //    the OAuth flow resumes to the RP protected page. No code to type: same-device is seamless.
      await test.step(STEPS.consume, async () => {
        await page.goto(link, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByText(/you are signed in as/i),
          "opening the magic link on the same device signs the user in and resumes to the RP",
        ).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(email, { exact: false }).first()).toBeVisible();
      });
    } finally {
      await context.close();
    }
  });

  test("error path: an invalid/expired magic link does not sign the user in", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = `${config.cli.envSlug || "magic-link-signin"}@example.com`;
    try {
      // Request a real link to discover the identity origin, then consume a GARBAGE token on it.
      await startSignInFromRp(page);
      await requestMagicLink(page, email);
      const real = await captureMagicLink(email);
      const bad = real.replace(/token=.*$/, "token=not-a-real-token");

      await page.goto(bad, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByText(/you are signed in as/i),
        "a bogus magic-link token must NOT sign the user in",
      ).toHaveCount(0);
      // identity renders the dedicated magic-link-error page for an invalid/expired/consumed token.
      await expect(page.getByText(/link|expired|invalid|sign-in/i).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
