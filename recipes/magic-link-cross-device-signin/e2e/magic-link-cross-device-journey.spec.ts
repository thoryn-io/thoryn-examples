/**
 * SSO-3048 (epic SSO-3046) — `magic-link-cross-device-signin`: ANOTHER-DEVICE passwordless sign-in,
 * demonstrating the anti-phishing CONTINUATION-CODE property (SSO-2613 adaptive cross-device magic-link).
 *
 * Two Playwright browser contexts = two physical devices (separate cookie jars):
 *   • Device A (initiator) starts the OAuth flow and requests a single-use email sign-in link — this
 *     sets the `ML_INIT` initiating-device cookie on A.
 *   • The link is captured from the per-run sandbox test inbox (channel `magic_link`).
 *   • Device B (a DIFFERENT context, NO `ML_INIT`) opens the link → identity detects cross-device and
 *     NEVER signs B in; instead it renders a short continuation code.
 *   • The code is typed back on Device A (bound by A's `ML_INIT`) → A completes → /protected.
 *
 * The security point: a link opened on another device (forwarded, prefetched by a mail scanner,
 * intercepted) cannot by itself complete the sign-in — only the initiating device can, with the code.
 *
 * ┌─ FIRST-LIVE-CONFIRM seams ───────────────────────────────────────────────────────────────────┐
 * │ (a) the hosted magic-link affordance (#magicLinkToggle → #magicLinkForm → #magicLinkEmail);     │
 * │ (b) the test-inbox captures the link (channel magic_link); (c) a cross-device open renders the   │
 * │     continuation-code page (`.code`) without signing B in; (d) the redeem form on A              │
 * │     (#magicLinkRedeemForm / #magicLinkCode) completes the sign-in; wrong code → #magicLinkCodeError.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
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

/** Reveal the magic-link affordance, enter the email, and request the link (sets ML_INIT on this device). */
async function requestMagicLink(page: Page, email: string): Promise<void> {
  await expect(page.locator("#magicLinkToggle")).toBeVisible({ timeout: 30_000 });
  await page.locator("#magicLinkToggle").click();
  await page.locator("#magicLinkEmail").fill(email);
  await page.locator("#magicLinkForm button[type=submit]").click();
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

test.describe("magic-link-cross-device-signin — passwordless sign-in ACROSS two devices (SSO-3048)", () => {
  test("full journey: A requests → B shows a continuation code → redeem on A → /protected", async ({ browser }) => {
    test.setTimeout(180_000);
    const deviceA = await browser.newContext({ ignoreHTTPSErrors: true });
    const deviceB = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();
    const email = `${config.cli.envSlug || "magic-link-cross-device-signin"}@example.com`;

    try {
      // 1) Device A starts the flow and requests the link (sets A's ML_INIT cookie).
      await test.step(STEPS.request, async () => {
        await startSignInFromRp(pageA);
        await requestMagicLink(pageA, email);
      });

      // 2) Capture the single-use link from the sandbox test inbox.
      let link = "";
      await test.step(STEPS.capture, async () => {
        link = await captureMagicLink(email);
      });

      // 3) Device B (no ML_INIT) opens the link → NOT signed in; a continuation code is shown.
      let code = "";
      await test.step(STEPS.otherDevice, async () => {
        await pageB.goto(link, { waitUntil: "domcontentloaded" });
        await expect(
          pageB.locator(".code"),
          "opening the link on ANOTHER device shows a continuation code, not a session",
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          pageB.getByText(/you are signed in as/i),
          "device B must NOT be signed in merely by opening the link (anti-phishing)",
        ).toHaveCount(0);
        code = ((await pageB.locator(".code").textContent()) ?? "").trim();
        expect(code, "device B shows a numeric continuation code").toMatch(/^\d{3,}$/);
      });

      // 4) Redeem the code on Device A (the initiator, carrying ML_INIT) → sign-in completes there.
      await test.step(STEPS.redeem, async () => {
        await expect(pageA.locator("#magicLinkCode")).toBeVisible({ timeout: 30_000 });
        await pageA.locator("#magicLinkCode").fill(code);
        await pageA.locator("#magicLinkRedeemForm button[type=submit]").click();
        await expect(
          pageA.getByText(/you are signed in as/i),
          "redeeming the code on the initiating device completes the sign-in and resumes to the RP",
        ).toBeVisible({ timeout: 30_000 });
        await expect(pageA.getByText(email, { exact: false }).first()).toBeVisible();
      });
    } finally {
      await deviceA.close();
      await deviceB.close();
    }
  });

  test("error path: a wrong continuation code is rejected on the initiating device", async ({ browser }) => {
    test.setTimeout(150_000);
    const deviceA = await browser.newContext({ ignoreHTTPSErrors: true });
    const deviceB = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();
    const email = `${config.cli.envSlug || "magic-link-cross-device-signin"}@example.com`;
    try {
      await startSignInFromRp(pageA);
      await requestMagicLink(pageA, email);
      const link = await captureMagicLink(email);

      await pageB.goto(link, { waitUntil: "domcontentloaded" });
      await expect(pageB.locator(".code")).toBeVisible({ timeout: 30_000 });

      // Wrong code on the initiating device → rejected, NOT signed in, non-leaky error banner.
      await expect(pageA.locator("#magicLinkCode")).toBeVisible({ timeout: 30_000 });
      await pageA.locator("#magicLinkCode").fill("000000");
      await pageA.locator("#magicLinkRedeemForm button[type=submit]").click();
      await expect(
        pageA.getByText(/you are signed in as/i),
        "a wrong continuation code must NOT sign the user in",
      ).toHaveCount(0);
      await expect(
        pageA.locator("#magicLinkCodeError"),
        "a wrong/expired code surfaces the dedicated cross-device error banner",
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await deviceA.close();
      await deviceB.close();
    }
  });
});
