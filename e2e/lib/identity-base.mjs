// SSO-3380 — resolve the identity-service BASE URL (its context root) from the hosted page itself.
//
// Since the SSO-3289 auth-host cutover, identity-service is mounted SAME-ORIGIN on the workspace auth
// host at the `/id` context path (`https://{slug}.auth.<domain>/id/...`), while `/` on that host is
// the hub. A spec that takes `new URL(page.url()).origin` as "the identity origin" and then builds
// ROOT-relative paths (`/account/security`, `/passkeys/register/begin`, `/mfa/totp/verify`, ...) talks
// to the HUB, not identity — which is exactly how passkey-signin (401 empty body from the hub
// resource-server chain) and totp-signin (302 to the hub's /login) went red.
//
// The product already publishes the answer: every identity template renders
// `<meta name="_ctx" content="@{/}">` (the context root — `/id/` after the cutover, `/` before it) and
// its own JS builds every endpoint as `window.__ctx + 'relative/path'`. The journeys do the same, so
// they follow whatever host + context path the product serves (pre-/post-cutover, custom domain)
// without hard-coding either.

/**
 * The identity base URL (always with a trailing slash) for a hosted page at [pageUrl] whose
 * `<meta name="_ctx">` content is [ctx].
 * @param {string | null | undefined} ctx  the `_ctx` meta content (e.g. `/id/` or `/`).
 * @param {string} pageUrl                  the URL of the page the meta was read from.
 * @returns {string}
 */
export function identityBaseFromCtx(ctx, pageUrl) {
  if (!ctx) {
    throw new Error(
      `the hosted identity page ${pageUrl} renders no <meta name="_ctx"> — the context-root contract every identity template carries`,
    );
  }
  const base = new URL(ctx, pageUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  base.search = "";
  base.hash = "";
  return base.href;
}

/**
 * An identity endpoint URL: [path] (leading slash tolerated) resolved UNDER [base], never against
 * the host root — `identityUrl("https://a.auth.x/id/", "/account/security")` is `.../id/account/security`.
 * @param {string} base  an identity base from {@link identityBaseFromCtx}.
 * @param {string} path  the identity-relative path.
 * @returns {string}
 */
export function identityUrl(base, path) {
  return new URL(path.replace(/^\/+/, ""), base).href;
}

/**
 * Read the identity base from the hosted identity page currently loaded in [page] (Playwright Page).
 * Fails loudly when the page is not an identity-rendered page (no `_ctx` meta).
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>}
 */
export async function identityBaseFrom(page) {
  const ctx = await page
    .locator('meta[name="_ctx"]')
    .first()
    .getAttribute("content", { timeout: 10_000 })
    .catch(() => null);
  return identityBaseFromCtx(ctx, page.url());
}
