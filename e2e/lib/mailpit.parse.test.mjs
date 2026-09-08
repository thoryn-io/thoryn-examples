// SSO-2909 — standalone node:test unit for the Mailpit link-parse seam.
// Runs WITHOUT a cluster (`node --test lib/mailpit.parse.test.mjs`, wired as
// `npm run test:unit`). This is the one piece of the harness testable in isolation
// — the parse regex is exactly what the live capture depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVerificationLink } from "./verification-link.mjs";

test("extracts the verify-email link from an HTML email body", () => {
  const body = `<p>Welcome! Please
    <a href="https://identity.127.0.0.1.nip.io/verify-email?token=abc-DEF_123">verify your email</a>.</p>`;
  assert.equal(
    extractVerificationLink(body),
    "https://identity.127.0.0.1.nip.io/verify-email?token=abc-DEF_123",
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
