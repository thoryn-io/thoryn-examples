/**
 * SSO-3045 (epic SSO-3042) — the `passkey-signin` example, driven end-to-end in a real browser against
 * the STAGING SaaS. It is `sandbox-signin` plus a phishing-resistant SECOND FACTOR: a WebAuthn passkey.
 *
 * A verified user exists in a fresh per-run sandbox. The journey ENROLS a passkey for that user via a
 * GENUINE `navigator.credentials.create` ceremony answered by a Playwright CDP virtual authenticator
 * (never faked), then activates a `password REQUIRED + passkey REQUIRED` login flow for the sandbox
 * (`thoryn login-flow set --activate`, SSO-3065), and proves a fresh sign-in is CHALLENGED for the
 * passkey and completes the assertion → /protected.
 *
 * WHY the enforce step (unlike totp-signin): passkey MFA is NOT enrolment-driven — an enrolled passkey
 * is challenged only when an ENFORCE-mode login flow has a REQUIRED PASSKEY stage the user can satisfy
 * (identity-service LoginFlowEnforceDriver). And enrol MUST precede enforce: the self-service passkey
 * register is session-gated, so the user first signs in with the password (the sandbox default flow),
 * enrols, and only THEN is the passkey-enforcing flow activated.
 *
 * The ceremony is driven in-page against the REAL endpoints (begin → decode the server's `publicKey`
 * options → navigator.credentials.create/get answered by the virtual authenticator → complete), the
 * same faithful dance the hosted passkey bundles run. The virtual authenticator is bound to ONE page's
 * CDP session and its resident credential survives `context.clearCookies()`, so the register + the
 * later assertion share the same page (the session is dropped between; the passkey is not).
 *
 * SSO-3380: every identity path here is resolved UNDER identity's context root, read from the hosted
 * page's own `<meta name="_ctx">` (e2e/lib/identity-base.mjs) — since the SSO-3289 cutover identity is
 * mounted at `/id` on the workspace auth host, whose root `/` is the HUB.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — FIRST-LIVE-CONFIRM seams (validated on the first live run):            │
 * │ (a) /passkeys/register/{begin,complete} reachable as the signed-in sandbox user   │
 * │     (SSO-3063 resolves the user by principal); (b) the WebAuthn rpId matches the  │
 * │     served identity host (SSO-3064) so the ceremony does not SecurityError;       │
 * │ (c) `thoryn login-flow set --activate` enforces the passkey stage for the sandbox │
 * │     env (SSO-3065); (d) a passkey-enrolled user is challenged at                  │
 * │     /mfa/passkey/challenge and the assertion resumes to the RP. If a seam differs, │
 * │     RECORD the real shape — do not fake a pass.                                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../../e2e/lib/config";
import { identityBaseFrom, identityUrl } from "../../../e2e/lib/identity-base.mjs";
import { STEPS } from "./scenario.mjs";

const execFileP = promisify(execFile);

/** Install a CDP virtual authenticator (internal CTAP2 resident-key, auto-UV) on [page]. */
async function installVirtualAuthenticator(page: Page): Promise<{ client: CDPSession; credentialCount: () => Promise<number> }> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return {
    client,
    async credentialCount() {
      const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
      return credentials.length;
    },
  };
}

interface CeremonyResult { status: number; body: Record<string, unknown> }

/**
 * Run a faithful in-page WebAuthn ceremony against [beginPath]/[completePath] — identity-RELATIVE
 * paths, resolved under the current hosted page's context root (its `_ctx` meta, exactly as the hosted
 * bundle's `window.__ctx + ...` does). The server returns Yubico `{publicKey:…}` options (base64url);
 * we decode them for the WebAuthn API, let the virtual authenticator answer
 * navigator.credentials.create|get, and POST the result. Reads the page's _csrf meta (same as the
 * hosted bundle). `kind`: "create" (register) or "get" (assertion).
 */
async function runCeremony(page: Page, kind: "create" | "get", beginPath: string, completePath: string, opts: { timeoutMs?: number } = {}): Promise<CeremonyResult> {
  const base = await identityBaseFrom(page);
  const beginUrl = identityUrl(base, beginPath);
  const completeUrl = identityUrl(base, completePath);
  return page.evaluate(async ({ kind, beginUrl, completeUrl, timeoutMs }) => {
    const meta = document.querySelector('meta[name="_csrf"]')?.getAttribute("content") ?? "";
    const hdr = document.querySelector('meta[name="_csrf_header"]')?.getAttribute("content") ?? "X-CSRF-TOKEN";
    const b64urlToBuf = (s: string): Uint8Array => { const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4)); return Uint8Array.from(atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); };
    const bufToB64url = (buf: ArrayBuffer): string => { let s = ""; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); };
    const begin = await fetch(beginUrl, { method: "POST", headers: { "Content-Type": "application/json", [hdr]: meta } });
    const beginText = await begin.text();
    let beginJson: any;
    try { beginJson = JSON.parse(beginText); } catch { return { status: begin.status, body: { beginError: true, text: beginText.slice(0, 200) } }; }
    const publicKey = beginJson.publicKey ?? beginJson;
    if (!publicKey || !publicKey.challenge) return { status: begin.status, body: { beginError: true, json: JSON.stringify(beginJson).slice(0, 200) } };
    publicKey.challenge = b64urlToBuf(publicKey.challenge);
    if (timeoutMs) publicKey.timeout = timeoutMs;
    if (kind === "create") {
      publicKey.user.id = b64urlToBuf(publicKey.user.id);
      if (publicKey.excludeCredentials) for (const c of publicKey.excludeCredentials) c.id = b64urlToBuf(c.id);
      const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
      const att = cred.response as AuthenticatorAttestationResponse;
      const payload = { id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type, response: { attestationObject: bufToB64url(att.attestationObject), clientDataJSON: bufToB64url(att.clientDataJSON) }, clientExtensionResults: cred.getClientExtensionResults?.() ?? {} };
      const complete = await fetch(completeUrl, { method: "POST", headers: { "Content-Type": "application/json", [hdr]: meta }, body: JSON.stringify(payload) });
      return { status: complete.status, body: await complete.json().catch(() => ({})) };
    } else {
      if (publicKey.allowCredentials) for (const c of publicKey.allowCredentials) c.id = b64urlToBuf(c.id);
      const asr = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
      const resp = asr.response as AuthenticatorAssertionResponse;
      const payload = { id: asr.id, rawId: bufToB64url(asr.rawId), type: asr.type, response: { authenticatorData: bufToB64url(resp.authenticatorData), clientDataJSON: bufToB64url(resp.clientDataJSON), signature: bufToB64url(resp.signature), userHandle: resp.userHandle ? bufToB64url(resp.userHandle) : null }, clientExtensionResults: asr.getClientExtensionResults?.() ?? {} };
      const complete = await fetch(completeUrl, { method: "POST", headers: { "Content-Type": "application/json", [hdr]: meta }, body: JSON.stringify(payload) });
      return { status: complete.status, body: await complete.json().catch(() => ({})) };
    }
  }, { kind, beginUrl, completeUrl, timeoutMs: opts.timeoutMs });
}

/** RP landing → "Sign in with Thoryn" → the sandbox's hub-federated hosted login. */
async function startSignInFromRp(page: Page): Promise<void> {
  await page.goto(`${config.rpBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /sign in with thoryn/i }).click();
}

/**
 * Fill + submit the hosted password form; return the identity BASE URL (context root, trailing slash)
 * it is served from — read from the page's `_ctx` meta, NOT the bare origin (whose root is the hub
 * since the SSO-3289 same-origin `/id` mount — SSO-3380).
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
 * Activate a `password REQUIRED + passkey REQUIRED` login flow for the per-run sandbox, via the CLI
 * (SSO-3065). Selects the sandbox env first, then sets + activates the flow — the same session +
 * env the workflow provisioned with. Passkey MFA is enforce-driven, so without this the passkey is
 * never challenged.
 */
async function enforcePasskeyFlow(): Promise<void> {
  const jar = config.cli.jarPath;
  const envSlug = config.cli.envSlug;
  expect(jar, "passkey enforce needs THORYN_JAR (the CLI the workflow signed in)").toBeTruthy();
  expect(envSlug, "passkey enforce needs SANDBOX_ENV_SLUG (the per-run sandbox)").toBeTruthy();
  // SSO-3068 — target the sandbox environment with `--environment` rather than `env use`. The CI
  // session is a client-credentials (API-key) login: it is already scoped to the workspace's
  // per-tenant issuer, but `env use` requires a `workspace switch` selection an API-key session
  // can never establish. `login-flow set --environment <slug>` rides X-Thoryn-Environment directly.
  await execFileP(
    "java",
    [
      "-jar", jar, "login-flow", "set",
      "--environment", envSlug,
      "--stage", "password:PASSWORD:REQUIRED",
      "--stage", "passkey:PASSKEY:REQUIRED",
      "--activate",
    ],
    { timeout: 60_000 },
  );
}

test.describe("passkey-signin example — enrol a passkey, then a fresh sign-in is challenged for the passkey second factor (SSO-3045)", () => {
  test("full journey: password sign-in → enrol passkey → enforce → re-sign-in is passkey-challenged → /protected", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    // ONE virtual authenticator for the page's lifetime — the resident passkey it mints survives the
    // clearCookies() between enrol and the challenge (the credential lives in the authenticator, not a cookie).
    const authenticator = await installVirtualAuthenticator(page);
    const email = `${config.cli.envSlug || "passkey-signin"}@example.com`;

    try {
      // 1) First sign-in with the password only (the user has no passkey yet; the flow is not yet enforced).
      let identityBase = "";
      await test.step(STEPS.firstSignin, async () => {
        await startSignInFromRp(page);
        identityBase = await submitPassword(page, email);
        await expect(
          page.getByText(/you are signed in as/i),
          "the first (password-only) sign-in reaches the RP protected page",
        ).toBeVisible({ timeout: 30_000 });
      });

      // 2) Enrol a passkey for the now-signed-in user — a real register ceremony on the session-gated
      //    /passkeys/register screen, answered by the virtual authenticator.
      await test.step(STEPS.enroll, async () => {
        await page.goto(identityUrl(identityBase, "passkeys/register"), { waitUntil: "domcontentloaded" });
        expect(new URL(page.url()).pathname, "the signed-in session reaches the passkey register screen").toContain(
          "/passkeys/register",
        );
        const reg = await runCeremony(page, "create", "passkeys/register/begin", "passkeys/register/complete");
        expect(reg.status, `passkey register/complete should 200 (got ${reg.status}) ${JSON.stringify(reg.body)}`).toBe(200);
        expect(reg.body.credentialId, "the server returned the new credential id").toBeTruthy();
        expect(await authenticator.credentialCount(), "a resident passkey was minted").toBe(1);
      });

      // 3) Activate the passkey-enforcing login flow for the sandbox (AFTER enrol — see file header).
      await test.step(STEPS.enforce, async () => {
        await enforcePasskeyFlow();
      });

      // 4) Fresh sign-in → now CHALLENGED for the passkey → assertion → resume → /protected.
      await test.step(STEPS.challenge, async () => {
        await context.clearCookies(); // drop the session; the resident passkey survives in the authenticator
        await startSignInFromRp(page);
        await submitPassword(page, email);
        await expect(
          page,
          "a passkey-enrolled user under the enforced flow is challenged at /mfa/passkey/challenge",
        ).toHaveURL(/\/mfa\/passkey\/challenge/, { timeout: 30_000 });
        const assertion = await runCeremony(page, "get", "mfa/passkey/authenticate/begin", "mfa/passkey/verify");
        expect(
          assertion.status < 300,
          `passkey assertion verify should 2xx (got ${assertion.status}) ${JSON.stringify(assertion.body)}`,
        ).toBeTruthy();
        const redirect = assertion.body.redirect as string | undefined;
        expect(redirect, "a valid passkey assertion returns the OAuth resume redirect").toBeTruthy();
        await page.goto(redirect!, { waitUntil: "domcontentloaded" });
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

  test("error path: an assertion from an EMPTY authenticator is rejected at the passkey challenge", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    // A FRESH, EMPTY virtual authenticator — it holds no credential for this user (the real passkey
    // was minted in the full-journey test's authenticator). The flow is already enforcing passkey and
    // the per-run user has a passkey server-side, so the challenge renders; the assertion must fail.
    const authenticator = await installVirtualAuthenticator(page);
    const email = `${config.cli.envSlug || "passkey-signin"}@example.com`;
    try {
      await startSignInFromRp(page);
      await submitPassword(page, email);
      await expect(page, "the passkey-enrolled user is challenged for the passkey on sign-in").toHaveURL(
        /\/mfa\/passkey\/challenge/,
        { timeout: 30_000 },
      );
      expect(await authenticator.credentialCount(), "this authenticator is empty").toBe(0);
      // The challenge screen carries identity's context-root contract — resolve it OUTSIDE the .catch
      // below so a missing `_ctx` fails loudly instead of masquerading as a rejected assertion.
      await identityBaseFrom(page);
      const outcome = await runCeremony(page, "get", "mfa/passkey/authenticate/begin", "mfa/passkey/verify", { timeoutMs: 2500 })
        .catch((e: Error) => ({ status: 0, body: { thrown: e.message } }));
      // Either navigator.credentials.get rejects client-side (no eligible credential), or the server
      // refuses the completion — never a successful authentication / resume redirect.
      expect((outcome.body as { redirect?: string }).redirect, "an empty-authenticator assertion must not resume").toBeFalsy();
      await expect(page.getByText(/you are signed in as/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
