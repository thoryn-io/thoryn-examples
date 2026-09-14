// SSO-3033 / SSO-3036 — read a SANDBOX environment's verification email from the
// SSO-3026 test-inbox via the `thoryn` CLI, for the sandbox-signin browser journey.
//
// Why not Mailpit (as simple-signin does): a sandbox SUPPRESSES real transactional
// email by design (identity `TestModeEmailGate`, SSO-2449) and captures it into a
// per-env inbox instead. The workflow's BYO-SMTP only carries WORKSPACE-plane mail, so
// a sandbox sign-up's verification link never reaches the in-job Mailpit sink — the
// first live run (2026-09-12) confirmed the captured row lands in `sandbox_email`, not
// the sink. The inbox is the product's own read surface for exactly this, exposed as
// `thoryn env test-emails` (SSO-3026, cli-v0.4.0). This is a genuine, non-faked capture:
// identity really generated and stored the email; we read it back through the supported
// API. It is the sandbox analogue of mailbox.ts's Mailpit read, with the same pure,
// unit-tested link-extraction seam (extractVerificationLink) as the fallback.
//
// The CLI is the prebuilt jar the workflow already uses for apply/teardown, signed in
// with a session that carries `tenant:environments.read` (added to the login scope for
// this suite). `list --output json` emits the captured emails newest-first, each with
// its `actionLink` (the verify URL) — so a single `list` call suffices; `get` and a
// body-parse are kept as defensive fallbacks.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractVerificationLink } from "./verification-link.mjs";

const execFileP = promisify(execFile);

/**
 * @typedef {Object} TestInboxConfig
 * @property {string} jarPath  Absolute path to the `thoryn.jar` on the runner.
 * @property {string} envSlug  The sandbox environment slug to read (e.g. `sbx-signin-…-1`).
 */

/** Run the CLI and return parsed stdout JSON, or null on any non-JSON / failure. */
async function runCliJson(jarPath, args) {
  try {
    const { stdout } = await execFileP("java", ["-jar", jarPath, ...args], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch {
    // A non-zero exit, a timeout, or non-JSON on stdout (e.g. not-signed-in) → treat as
    // "nothing yet"; the spec drives the retry with expect.poll so transient states pass.
    return null;
  }
}

/** Normalise the `list` JSON into an array of email records (array, or `{emails:[…]}`). */
function emailsOf(listJson) {
  if (Array.isArray(listJson)) return listJson;
  if (listJson && Array.isArray(listJson.emails)) return listJson.emails;
  return [];
}

const isVerifyLink = (s) => typeof s === "string" && /\/verify-email\?token=/.test(s);
// SSO-3079: the sandbox-captured password-reset link (PasswordResetService resetPath=/password-reset).
const isResetLink = (s) => typeof s === "string" && /\/password-reset\?token=/.test(s);

/**
 * One-shot: find the newest email-verification message to [recipient] in the sandbox's
 * test inbox and return its verify link, or null if it hasn't been captured yet. Wrap in
 * Playwright's `expect.poll` exactly like the Mailpit `findVerificationLink`.
 *
 * @param {TestInboxConfig} cfg
 * @param {string} recipient
 * @returns {Promise<string | null>}
 */
export async function findVerificationLinkViaInbox(cfg, recipient) {
  if (!cfg.jarPath || !cfg.envSlug) {
    throw new Error(
      "test-inbox capture needs THORYN_JAR + SANDBOX_ENV_SLUG (the sandbox journey runs the CLI against the per-run sandbox)",
    );
  }
  const list = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "list",
    "--env", cfg.envSlug,
    "--to", recipient,
    "--channel", "email_verification",
    "--limit", "50",
    "--output", "json",
  ]);
  const emails = emailsOf(list);
  if (emails.length === 0) return null;

  // Product-api returns newest-first (created_at DESC); element 0 is the most recent.
  const newest = emails[0];
  if (isVerifyLink(newest?.actionLink)) return newest.actionLink;

  // Fallbacks (defensive; `list` already carries actionLink): fetch the single record,
  // then parse the body the same way the Mailpit path does.
  const id = newest?.id;
  if (!id) return null;
  const rec = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "get", String(id), "--env", cfg.envSlug, "--output", "json",
  ]);
  if (isVerifyLink(rec?.actionLink)) return rec.actionLink;
  return extractVerificationLink(`${rec?.bodyHtml ?? ""}\n${rec?.body ?? ""}`);
}


const isMagicLink = (s) => typeof s === "string" && /\/auth\/magic-link\/consume\?token=/.test(s);

/**
 * SSO-3047 — sibling of [findVerificationLinkViaInbox] for the passwordless MAGIC-LINK flow.
 * In a sandbox, the magic-link email is suppressed from real SMTP (identity `TestModeEmailGate`,
 * channel `magic_link`) and captured into the per-env test inbox (SandboxInboxController). We read
 * it back through the supported `thoryn env test-emails` surface and return the single-use sign-in
 * link (`/auth/magic-link/consume?token=…`), or null if it hasn't been captured yet — wrap in
 * Playwright's `expect.poll`, exactly like the verification-link capture.
 *
 * @param {TestInboxConfig} cfg
 * @param {string} recipient
 * @returns {Promise<string | null>}
 */
export async function findMagicLinkViaInbox(cfg, recipient) {
  if (!cfg.jarPath || !cfg.envSlug) {
    throw new Error(
      "test-inbox capture needs THORYN_JAR + SANDBOX_ENV_SLUG (the magic-link journey runs the CLI against the per-run sandbox)",
    );
  }
  const list = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "list",
    "--env", cfg.envSlug,
    "--to", recipient,
    "--channel", "magic_link",
    "--limit", "50",
    "--output", "json",
  ]);
  const emails = emailsOf(list);
  if (emails.length === 0) {
    // SSO-3051 diagnostic: the magic_link-filtered inbox is empty. Dump the WHOLE inbox ONCE so we can
    // tell "no email generated at all" (env/user-resolution gap at /auth/magic-link/request) from
    // "email present under another channel / field" (a capture-field issue). Logged once, best-effort.
    if (!globalThis.__mlInboxDumped) {
      globalThis.__mlInboxDumped = true;
      try {
        const all = await runCliJson(cfg.jarPath, [
          "env", "test-emails", "list", "--env", cfg.envSlug, "--limit", "50", "--output", "json",
        ]);
        const rows = emailsOf(all).map((e) => ({ to: e?.toAddress ?? e?.to, channel: e?.channel, actionLink: e?.actionLink }));
        console.error(`[ml-diagnostic] magic_link filter empty for ${recipient}. Whole inbox (${rows.length}): ${JSON.stringify(rows)}`);
      } catch (e) {
        console.error(`[ml-diagnostic] inbox dump failed: ${e}`);
      }
    }
    return null;
  }

  // Newest-first (created_at DESC); element 0 is the most recently requested link.
  const newest = emails[0];
  if (isMagicLink(newest?.actionLink)) return newest.actionLink;

  // Defensive fallback: fetch the single record and scan its body for the consume URL.
  const id = newest?.id;
  if (!id) return null;
  const rec = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "get", String(id), "--env", cfg.envSlug, "--output", "json",
  ]);
  if (isMagicLink(rec?.actionLink)) return rec.actionLink;
  const body = `${rec?.bodyHtml ?? ""}\n${rec?.body ?? ""}`;
  const m = body.match(/https?:\/\/[^\s"'<>]+\/auth\/magic-link\/consume\?token=[^\s"'<>]+/);
  return m ? m[0] : null;
}

/**
 * SSO-2595 — sibling of [findMagicLinkViaInbox] for the passwordless MAGIC-CODE (6-digit email OTP)
 * flow. In a sandbox the magic-code email is suppressed from real SMTP (identity `TestModeEmailGate`,
 * channel `magic_code`) and captured into the per-env test inbox (SSO-3074, mirroring magic-link). We
 * read it back through `thoryn env test-emails` and extract the 6-digit code from the rendered body
 * (there is no link — the code is the payload), or null if it hasn't been captured yet — wrap in
 * Playwright's `expect.poll`, exactly like the magic-link capture.
 *
 * @param {TestInboxConfig} cfg
 * @param {string} recipient
 * @returns {Promise<string | null>}
 */
export async function findMagicCodeViaInbox(cfg, recipient) {
  if (!cfg.jarPath || !cfg.envSlug) {
    throw new Error(
      "test-inbox capture needs THORYN_JAR + SANDBOX_ENV_SLUG (the magic-code journey runs the CLI against the per-run sandbox)",
    );
  }
  const list = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "list",
    "--env", cfg.envSlug,
    "--to", recipient,
    "--channel", "magic_code",
    "--limit", "50",
    "--output", "json",
  ]);
  const emails = emailsOf(list);
  if (emails.length === 0) return null;

  // Newest-first (created_at DESC); element 0 is the most recently requested code. The code is in the
  // body (no actionLink), so fetch the single record and extract the 6-digit value.
  const id = emails[0]?.id;
  if (!id) return null;
  const rec = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "get", String(id), "--env", cfg.envSlug, "--output", "json",
  ]);
  return extractMagicCode(`${rec?.bodyHtml ?? ""}\n${rec?.body ?? ""}`);
}

/**
 * Extract a 6-digit magic-code from an email body. The template renders it in `<span class="code">`;
 * we take the first standalone 6-digit run (word-boundaried so a longer number isn't mis-matched).
 * @param {string} body
 * @returns {string | null}
 */
export function extractMagicCode(body) {
  // Prefer the span.code payload when present, else the first standalone 6-digit run.
  const span = body.match(/class=["']code["'][^>]*>\s*(\d{6})\s*</i);
  if (span) return span[1];
  const m = body.match(/(?<!\d)(\d{6})(?!\d)/);
  return m ? m[1] : null;
}

/**
 * SSO-3079 — poll a sandbox's test inbox for the newest PASSWORD-RESET email to [recipient] and return
 * its reset link (the captured `actionLink`, `<base>/password-reset?token=...`), or null if it hasn't
 * been captured yet. Wrap in `expect.poll`. Same CLI path as findVerificationLinkViaInbox; only the
 * channel (`password_reset`) and the link shape differ. A sandbox suppresses the real SMTP send and
 * captures the reset link here (SSO-3074-style), so this is a genuine, non-faked capture of the email.
 */
export async function findResetLinkViaInbox(cfg, recipient) {
  if (!cfg.jarPath || !cfg.envSlug) {
    throw new Error(
      "test-inbox capture needs THORYN_JAR + SANDBOX_ENV_SLUG (the sandbox journey runs the CLI against the per-run sandbox)",
    );
  }
  const list = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "list",
    "--env", cfg.envSlug,
    "--to", recipient,
    "--channel", "password_reset",
    "--limit", "50",
    "--output", "json",
  ]);
  const emails = emailsOf(list);
  if (emails.length === 0) return null;
  const newest = emails[0];
  if (isResetLink(newest?.actionLink)) return newest.actionLink;
  const id = newest?.id;
  if (!id) return null;
  const rec = await runCliJson(cfg.jarPath, [
    "env", "test-emails", "get", String(id), "--env", cfg.envSlug, "--output", "json",
  ]);
  if (isResetLink(rec?.actionLink)) return rec.actionLink;
  const body = `${rec?.bodyHtml ?? ""}\n${rec?.body ?? ""}`;
  const m = body.match(/https?:\/\/[^\s"'<>]+\/password-reset\?token=[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}
