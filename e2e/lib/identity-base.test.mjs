// SSO-3380 — unit tests for the pure identity-base resolution (no browser, no staging creds).
// Run: `node --test e2e/lib/identity-base.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { identityBaseFromCtx, identityUrl } from "./identity-base.mjs";

const LOGIN = "https://acme.auth.stg.thoryn.org/id/login?continue=abc#frag";

test("post-cutover: the /id context root on the workspace auth host is the identity base", () => {
  assert.equal(identityBaseFromCtx("/id/", LOGIN), "https://acme.auth.stg.thoryn.org/id/");
});

test("a context root rendered without a trailing slash still yields a directory base", () => {
  assert.equal(identityBaseFromCtx("/id", LOGIN), "https://acme.auth.stg.thoryn.org/id/");
});

test("pre-cutover: a root context on a dedicated identity host is the origin root", () => {
  assert.equal(
    identityBaseFromCtx("/", "https://acme.identity.stg.thoryn.org/login?x=1"),
    "https://acme.identity.stg.thoryn.org/",
  );
});

test("endpoint paths resolve UNDER the context root, never against the host root (which is the hub)", () => {
  const base = identityBaseFromCtx("/id/", LOGIN);
  assert.equal(identityUrl(base, "/account/security"), "https://acme.auth.stg.thoryn.org/id/account/security");
  assert.equal(identityUrl(base, "passkeys/register/begin"), "https://acme.auth.stg.thoryn.org/id/passkeys/register/begin");
  assert.equal(identityUrl(base, "//mfa/totp/verify"), "https://acme.auth.stg.thoryn.org/id/mfa/totp/verify");
});

test("a page without the _ctx meta is rejected loudly rather than silently falling back to the host root", () => {
  assert.throws(() => identityBaseFromCtx(null, LOGIN), /renders no <meta name="_ctx">/);
  assert.throws(() => identityBaseFromCtx("", LOGIN), /renders no <meta name="_ctx">/);
});
