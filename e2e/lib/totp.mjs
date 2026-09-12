// SSO-3043 (epic SSO-3042) — a PURE RFC-6238 TOTP computer for the 2FA example journeys, in plain
// JS (node:crypto only, no dependency) so a node:test unit can exercise it WITHOUT staging creds or a
// tsc build — the same pattern as verification-link.mjs. The browser journey reads the enrolment
// secret off the hosted TOTP enrol screen and calls totp() to answer the /mfa/totp/challenge.
//
// Genuine, non-faked: the same algorithm a real authenticator app runs (HMAC-SHA1 over the 30s time
// counter, dynamic truncation). Verified against the RFC 6238 Appendix-B test vector in totp.test.mjs.
import crypto from "node:crypto";

/** RFC 4648 base32 decode (the shape authenticator `secret=` values use). Ignores padding/whitespace. */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue; // defensive: skip any non-base32 char
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Compute the TOTP code for [secretBase32] at time [at] (ms since epoch).
 * @param {string} secretBase32  the authenticator secret (base32).
 * @param {{at?:number, step?:number, digits?:number, algo?:string}} opts
 * @returns {string} the zero-padded code.
 */
export function totp(secretBase32, { at = Date.now(), step = 30, digits = 6, algo = "sha1" } = {}) {
  const key = base32Decode(secretBase32);
  let counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = crypto.createHmac(algo, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * Extract the base32 secret from an `otpauth://…?secret=…` URI or a displayed secret string. Returns
 * the uppercased secret, or null. The hosted TOTP enrol screen shows the secret (and/or a QR whose
 * payload is an otpauth URI); the e2e reads whichever is in the DOM and feeds it to [totp].
 */
export function secretFromOtpauth(text) {
  if (!text) return null;
  const fromUri = text.match(/[?&]secret=([A-Za-z2-7]+)/);
  if (fromUri) return fromUri[1].toUpperCase();
  // A bare displayed secret: a run of base32 chars (grouped display may include spaces — strip them).
  const compact = text.replace(/\s+/g, "");
  const bare = compact.match(/\b([A-Z2-7]{16,})\b/i);
  return bare ? bare[1].toUpperCase() : null;
}
