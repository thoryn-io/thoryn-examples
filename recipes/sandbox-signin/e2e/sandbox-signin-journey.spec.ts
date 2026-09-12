/**
 * SSO-2969 (epic SSO-2959) — the `sandbox-signin` example, driven end-to-end in a real
 * browser against the STAGING SaaS. It is the browser-driven sibling of the
 * `simple-signin` journey, with one deliberate difference: the relying party is pointed
 * at a FRESH, per-run SANDBOX ENVIRONMENT (created by the recipe's `env.create` step
 * inside the standing workspace) rather than a freshly-minted workspace. That is the
 * whole point of `sandbox-signin` — per-run isolation WITHOUT the workspace-create scope
 * a tenant-scoped API key can't hold (the SSO-2943 gap).
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
 *   2–5. Same Path-B legs as simple-signin: self-service sign-up → capture the REAL
 *      verification email from the in-job Mailpit sink → verify → sign in → /protected.
 *
 * The headline human flow in the recipe README is the sandbox TEST-INBOX round trip
 * (`thoryn env test-emails`): a sandbox suppresses real transactional email and captures
 * it into a per-env inbox the CLI reads. This browser harness cannot drive the CLI inbox
 * (it drives the hosted UI, not the CLI), so it captures the SAME genuinely-sent email
 * from the CI Mailpit sink the sandbox-e2e workflow wires via the standing workspace's
 * BYO-SMTP — an equivalent, non-faked capture of the real email. Exercising the
 * `thoryn env test-emails` inbox itself belongs in a CLI-level conformance check (noted
 * as follow-up in E2E_RESULTS.md), not this browser journey.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — the FIRST LIVE sandbox run is the validation. Beyond simple-signin's │
 * │ three LIVE-CONFIRM seams, it must confirm the sandbox-specific NOTE(SSO-2969):  │
 * │  • identity.registerUser + self-service sign-up are honoured PER-ENVIRONMENT,   │
 * │  • the sandbox per-env issuer (workspace issuer + /{env-slug} path) serves the   │
 * │    hosted login, and                                                            │
 * │  • a WORKSPACE-level BYO-SMTP still routes a sandbox sign-up's verification       │
 * │    email to the sink.                                                           │
 * │ If any lands at workspace scope instead, that is a product gap to RECORD         │
 * │ (SSO-2943 family) — not a shortcut to paper over here.                          │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type Page } from "@playwright/test";
import { config } from "../../../e2e/lib/config";
import { findVerificationLink } from "../../../e2e/lib/mailbox";
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

test.describe("sandbox-signin example — fresh sandbox env → self-service sign-up → verify → sign in via the loopback RP (SSO-2969)", () => {
  test("full Path-B journey signs a verified user in to the RP's protected page against the sandbox issuer", async ({
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

      // 3) Capture the REAL verification email from the in-job Mailpit sink.
      //    NOTE(SSO-2969): confirms a WORKSPACE-level BYO-SMTP routes a SANDBOX
      //    sign-up's email to the sink — the first live run proves (or records) this.
      let verifyLink: string | null = null;
      await test.step(STEPS.capture, async () => {
        await expect
          .poll(
            async () => {
              verifyLink = await findVerificationLink(request, config.mailpit, email);
              return verifyLink;
            },
            {
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
