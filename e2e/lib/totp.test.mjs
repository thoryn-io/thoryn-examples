// SSO-3043 — unit tests for the pure TOTP computer. Verified against the RFC 6238 Appendix-B test
// vectors (SHA1, seed ASCII "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ).
// Run: `node --test e2e/lib/totp.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { totp, secretFromOtpauth } from "./totp.mjs";

const SEED32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")

test("RFC 6238 Appendix-B SHA1 vectors (8 digits)", () => {
  assert.equal(totp(SEED32, { at: 59_000, digits: 8 }), "94287082");
  assert.equal(totp(SEED32, { at: 1_111_111_109_000, digits: 8 }), "07081804");
  assert.equal(totp(SEED32, { at: 1_111_111_111_000, digits: 8 }), "14050471");
  assert.equal(totp(SEED32, { at: 1_234_567_890_000, digits: 8 }), "89005924");
});

test("default is a 6-digit code derived from the same vector", () => {
  // The 6-digit code is the last 6 digits of the 8-digit vector (mod 1e6).
  assert.equal(totp(SEED32, { at: 59_000 }), "287082");
  assert.match(totp(SEED32, { at: Date.now() }), /^\d{6}$/);
});

test("secretFromOtpauth reads the secret from an otpauth URI, a bare string, and spaced display", () => {
  assert.equal(
    secretFromOtpauth("otpauth://totp/Thoryn:demo@example.com?secret=GEZDGNBVGY3TQOJQ&issuer=Thoryn"),
    "GEZDGNBVGY3TQOJQ",
  );
  assert.equal(secretFromOtpauth("JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP");
  assert.equal(secretFromOtpauth("JBSW Y3DP EHPK 3PXP"), "JBSWY3DPEHPK3PXP");
  assert.equal(secretFromOtpauth(null), null);
});
