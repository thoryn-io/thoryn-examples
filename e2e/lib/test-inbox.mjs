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
