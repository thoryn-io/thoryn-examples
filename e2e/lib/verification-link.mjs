// SSO-2909 — the pure verification-link parse seam, in plain JS so a node:test
// unit (lib/mailbox.parse.test.mjs) can exercise it WITHOUT staging creds or a
// tsc build. mailbox.ts re-exports this so there is a single source of truth.

/**
 * Extract the identity email-verification link (`<base>/verify-email?token=…`)
 * from an email body. The token is URL-safe base64 (no padding) — see identity's
 * EmailVerificationService.generateToken. Returns the FIRST such absolute URL, or
 * null.
 * @param {string} body
 * @returns {string | null}
 */
export function extractVerificationLink(body) {
  const match = body.match(/https?:\/\/[^\s"'<>]+\/verify-email\?token=[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}
