/**
 * SSO-3039 (epic SSO-2871) — the `branded-signin` example, driven end-to-end in a real
 * browser against the STAGING SaaS. It is `sandbox-signin` plus ONE added concept: the
 * recipe's `tenant.configureLoginTheme` step STYLES the sandbox's hosted sign-in screen
 * (the same customer-plane surface `thoryn branding set` wraps, SSO-3037), and this
 * journey ASSERTS the rendered login carries that brand — the `--brand-primary` CSS
 * custom property equals the recipe's primaryColor. The relying party is pointed at a
 * FRESH, per-run SANDBOX ENVIRONMENT (the recipe's `env.create`), so the branding is
 * per-environment and torn down with the sandbox.
 *
 * This spec is COLOCATED with the recipe it validates (recipes/sandbox-signin/e2e/) and
 * imports the SHARED harness (config, Mailpit capture) from the repo-root `e2e/` tree —
 * the same reusable home the simple-signin spec imports, so there is zero duplicated
 * setup. Step titles come from ./scenario.mjs (the single source the generated
 * E2E_RESULTS.md "Steps" list uses too).
 *
 *   0. (Deterministic, sandbox-specific) the RP's /login 302 points at the SANDBOX
 *      per-env issuer's /oauth2/authorize — proving the RP is wired to the sandbox,
 *      not the standing workspace.
 *   1. Open the REAL loopback RP (../apps/loopback-rp/server.js):
 *      GET / → "Sign in with Thoryn" → RP 302s to {sandbox-issuer}/oauth2/authorize
 *      → the hub federates to the tenant's identity → its hosted login renders.
 *   2–5. Sandbox Path-B legs: self-service sign-up → capture the REAL verification email
 *      from the sandbox TEST-INBOX (via `thoryn env test-emails`) → verify → sign in →
 *      /protected.
 *
 * Email capture is the ONE deliberate difference from simple-signin. A sandbox SUPPRESSES
 * real transactional email by design (identity `TestModeEmailGate`, SSO-2449) and captures
 * it into a per-env inbox (SSO-3026) — so a sandbox sign-up's verification email never
 * reaches an SMTP sink. The 2026-09-12 first live run proved this: the RP reached the
 * hosted login and sign-up succeeded, but the verification email landed in `sandbox_email`,
 * NOT the in-job Mailpit (the earlier NOTE(SSO-2969) "a workspace BYO-SMTP routes a sandbox
 * sign-up's email to the sink" assumption was disproven — it is correct suppression, not a
 * gap). So this journey reads the verify link from the sandbox test-inbox through the
 * product's own read surface (`thoryn env test-emails`, the recipe README's headline flow) —
 * a genuine, non-faked capture of the real email. simple-signin stays on Mailpit (it
 * provisions a workspace, where email really sends). See e2e/lib/test-inbox.mjs.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ LIVE-CONFIRMED (2026-09-12, SSO-3033/SSO-3036): the sandbox-specific seams —    │
 * │  • self-service sign-up is honoured PER-ENVIRONMENT,                            │
 * │  • the sandbox per-env issuer (workspace issuer + /{env-slug} path) serves the   │
 * │    hosted login (once SSO-3036 auto-attaches the env IdP — no federation_required),│
 * │  • a sandbox sign-up's verification email is captured to the per-env test-inbox. │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { findVerificationLinkViaInbox } from "../../../e2e/lib/test-inbox.mjs";
import { STEPS } from "./scenario.mjs";

/** Unique per run so reruns never 409 and the Mailpit match is unambiguous. */
function uniqueEmail(): string {
  return `sandbox-signin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@thoryn.test`;
}

/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/** From the hosted login, reach the self-service register form (LIVE-CONFIRM (a)). */
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

test.describe("branded-signin example — fresh sandbox env with a BRANDED hosted login → sign up → verify → sign in (SSO-3039)", () => {
  test("full Path-B journey signs a verified user in against the sandbox issuer, with the login carrying the recipe's brand", async ({
    browser,
    request,
  }) => {
    // RP round-trip + real email delivery + Mailpit polling + two hosted form legs.
    test.setTimeout(180_000);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const email = uniqueEmail();

    try {
      // 0+1) The RP points at the SANDBOX per-env issuer, then → hosted login.
      await test.step(STEPS.sandboxIssuer, async () => {
        // Deterministic, sandbox-specific assertion: the RP's /login 302 target is the
        // sandbox per-env issuer's authorize endpoint (not the standing workspace's).
        // Only assert when the issuer is configured (it always is in the sandbox-e2e
        // workflow, which sets THORYN_ISSUER to the resolved per-env issuer).
        if (config.issuerBaseUrl) {
          const resp = await request.get(`${config.rpBaseUrl}/login`, {
            maxRedirects: 0,
            ignoreHTTPSErrors: true,
          });
          expect(
            resp.status(),
            "the RP's /login issues an OAuth authorize redirect",
          ).toBe(302);
          expect(
            resp.headers()["location"] ?? "",
            "the RP redirects to the SANDBOX per-env issuer's authorize endpoint",
          ).toContain(`${config.issuerBaseUrl}/oauth2/authorize`);
        }

        // SSO-3033: a FRESH per-run sandbox's per-env issuer can lag a few seconds behind env.create
        // (hub mirror / discovery publish), so wait until its discovery actually serves before driving
        // the RP — otherwise the authorize → federation → hosted-login chain races the issuer coming up
        // and the login form never renders in time. Mirrors oathy's sandbox-environment `waitForEnvironment`.
        if (config.issuerBaseUrl) {
          await expect
            .poll(
              async () =>
                (await request.get(`${config.issuerBaseUrl}/.well-known/openid-configuration`, { ignoreHTTPSErrors: true })).status(),
              { message: "the sandbox per-env issuer's discovery is served before sign-in", timeout: 90_000 },
            )
            .toBe(200);
        }

        await startSignInFromRp(page);
        await expect(
          page.locator("#passwordForm"),
          "the RP sign-in reaches the identity hosted login via the sandbox hub",
        ).toBeVisible({ timeout: 30_000 });

        // SSO-3039 — the headline of THIS recipe: the `tenant.configureLoginTheme` step styled this
        // sandbox's hosted login (primaryColor #7c3aed, the recipe default). Prove the branding reached
        // the rendered screen — identity emits it as the `--brand-primary` CSS custom property in the
        // login template's inline :root. This is the end-to-end proof that the recipe / `thoryn branding`
        // actually re-skins the sign-in screen per environment. (If the recipe's primaryColor default
        // changes, update this expected value; the workflow applies with the default, no --set override.)
        const brandPrimary = (
          await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--brand-primary"),
          )
        )
          .trim()
          .toLowerCase();
        expect(brandPrimary, "the sandbox hosted login renders the recipe-configured --brand-primary").toBe(
          "#7c3aed",
        );

        // SSO-3038: the recipe also set an allowlisted CSS-variable (--thoryn-accent #0369a1). Prove
        // the CSS-variable map renders too — the extensible styling surface beyond the fixed fields.
        const accent = (
          await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--thoryn-accent"),
          )
        )
          .trim()
          .toLowerCase();
        expect(accent, "the sandbox hosted login renders the recipe-configured --thoryn-accent CSS variable").toBe(
          "#0369a1",
        );
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

      // 3) Capture the REAL verification email from the sandbox TEST-INBOX via the CLI.
      //    A sandbox SUPPRESSES real transactional email by design (identity TestModeEmailGate,
      //    SSO-2449) and captures it into a per-env inbox (SSO-3026) — so a sandbox sign-up's
      //    verification email NEVER reaches the Mailpit sink (the 2026-09-12 live run confirmed
      //    the captured row lands in `sandbox_email`, not the BYO-SMTP sink). The inbox is the
      //    product's own read surface for exactly this (`thoryn env test-emails`); reading it is a
      //    genuine, non-faked capture of the real email. See e2e/lib/test-inbox.mjs.
      let verifyLink: string | null = null;
      await test.step(STEPS.capture, async () => {
        await expect
          .poll(
            async () => {
              verifyLink = await findVerificationLinkViaInbox(config.cli, email);
              return verifyLink;
            },
            {
              message: `verification email to ${email} captured from the sandbox test-inbox (env ${config.cli.envSlug})`,
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
      //    The user was provisioned into the sandbox, so it must authenticate against
      //    the sandbox per-env issuer (NOTE(SSO-2969): per-env user resolution).
      await test.step(STEPS.signin, async () => {
        await startSignInFromRp(page);
        await expect(page.locator("#passwordForm")).toBeVisible();
        await submitLogin(page, email);

        // Back on the loopback RP's protected page, signed in. (Hard assertions.)
        await expect(
          page.getByText(/you are signed in as/i),
          "the OIDC code flow completes and the RP renders its protected page",
        ).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(email, { exact: false }).first()).toBeVisible();

        // Best-effort (NON-fatal): the RP renders the ID-token claims as a table; if an
        // `env` claim is present it should name the sandbox. Whether the sandbox per-env
        // issuer stamps an `env` claim is UNPROVEN (SSO-2969), so this is recorded as an
        // annotation, not asserted — we must not fake a pass on an unconfirmed seam.
        const envCell = page.locator("table td", { hasText: /^env$/ });
        if (await envCell.count()) {
          const envValue = (await envCell.first().locator("xpath=following-sibling::td[1]").textContent())?.trim();
          test.info().annotations.push({ type: "sandbox-env-claim", description: envValue ?? "(empty)" });
        } else {
          test.info().annotations.push({
            type: "sandbox-env-claim",
            description: "no `env` claim rendered — confirm whether the sandbox per-env issuer stamps one (SSO-2969)",
          });
        }
      });
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
