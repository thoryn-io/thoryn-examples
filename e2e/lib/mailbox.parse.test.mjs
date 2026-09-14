// SSO-2909 — standalone node:test unit for the verification-link parse seam.
// Runs WITHOUT staging creds or a browser (`node --test lib/mailbox.parse.test.mjs`,
// wired as `npm run test:unit`). This is the one piece of the harness testable in
// isolation — the parse regex is exactly what the live Mailpit capture depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVerificationLink, extractResetLink, extractUnlockLink } from "./verification-link.mjs";

test("extracts the verify-email link from an HTML email body", () => {
  const body = `<p>Welcome! Please
    <a href="https://identity.stg.thoryn.org/verify-email?token=abc-DEF_123">verify your email</a>.</p>`;
  assert.equal(
    extractVerificationLink(body),
    "https://identity.stg.thoryn.org/verify-email?token=abc-DEF_123",
  );
});

test("extracts a plain-text verify-email link", () => {
  const body = "Verify: https://login.example.gov/verify-email?token=Zm9vYmFy then sign in.";
  assert.equal(
    extractVerificationLink(body),
    "https://login.example.gov/verify-email?token=Zm9vYmFy",
  );
});

test("returns the FIRST link when several are present", () => {
  const body =
    "a https://h/verify-email?token=one b https://h/verify-email?token=two";
  assert.equal(extractVerificationLink(body), "https://h/verify-email?token=one");
});

test("stops the token at the first non-token character (quote / angle bracket)", () => {
  const body = `href="https://h/verify-email?token=tok123"`;
  assert.equal(extractVerificationLink(body), "https://h/verify-email?token=tok123");
});

test("returns null when there is no verify-email link", () => {
  assert.equal(extractVerificationLink("just a normal email, no link"), null);
  assert.equal(extractVerificationLink("https://h/reset-password?token=x"), null);
  assert.equal(extractVerificationLink(""), null);
});

test("SSO-3078: extracts the password-reset link from an HTML email body", () => {
  const body = `<p>Reset it here:
    <a href="https://identity.stg.thoryn.org/password-reset?token=rst-ABC_789">set a new password</a>.</p>`;
  assert.equal(
    extractResetLink(body),
    "https://identity.stg.thoryn.org/password-reset?token=rst-ABC_789",
  );
});

test("SSO-3078: reset extractor does not match the /password-reset/initiate request page", () => {
  const body = 'Request a reset at https://h/password-reset/initiate (no token here).';
  assert.equal(extractResetLink(body), null);
});

test("SSO-1905: extracts the account-unlock link from an HTML email body", () => {
  const body = `<p>Unlock:
    <a href="https://identity.stg.thoryn.org/account/unlock?token=unl-XYZ_456">unlock my account</a>.</p>`;
  assert.equal(
    extractUnlockLink(body),
    "https://identity.stg.thoryn.org/account/unlock?token=unl-XYZ_456",
  );
});
