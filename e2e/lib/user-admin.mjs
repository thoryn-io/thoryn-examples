/**
 * SSO-3081 — drive a user SUSPEND through the supported `thoryn users` CLI surface, so the
 * simple-signin negative e2e can assert the suspended-login branch WITHOUT a raw API call / DB
 * patch (the product-boundary rule).
 *
 * A fresh self-service user is registered in-browser by the spec; to suspend it we shell out to the
 * SAME `thoryn.jar` the workflow uses, but authenticate a SEPARATE client-credentials session into an
 * ISOLATED token file (THORYN_TOKEN_FILE — the CLI's own path-override seam, robust where the
 * runner's `user.home` doesn't track $HOME) requesting only `tenant:users.{write,read}`. That
 * isolation means: (a) a missing scope grant on the CI key fails only this one test, not the suite,
 * and (b) the provisioning session the teardown step reuses is never clobbered. The suspend is
 * confirmation-gated on the production plane, so `--confirm <workspace-slug>` rides along.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

/** True only when every piece the suspend path needs is configured (else the spec skips the case). */
export function userAdminConfigured(cfg) {
  const c = cfg.cli;
  return Boolean(c && c.jarPath && c.apiKey && c.issuer && c.workspaceSlug && c.gateway);
}

function isolatedEnv(tokenFile, extra = {}) {
  return { ...process.env, THORYN_TOKEN_FILE: tokenFile, THORYN_CI_PLAINTEXT_TOKENS: "1", ...extra };
}

/** Run the CLI; on a non-zero exit throw an Error carrying the CLI's stderr/stdout so failures are visible. */
async function runCli(cfg, env, args) {
  try {
    return await execFileP("java", ["-jar", cfg.cli.jarPath, ...args], { env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    const detail = [e.stderr, e.stdout].map((s) => (s || "").toString().trim()).filter(Boolean).join(" | ");
    throw new Error(`\`thoryn ${args.join(" ")}\` failed (exit ${e.code ?? "?"}): ${detail || e.message}`);
  }
}

/**
 * Authenticate a client-credentials session for user administration into an ISOLATED token file,
 * returning that file's path (passed back into [suspendUserByEmail]). Requests only the two user
 * scopes so it never widens the CI key's effective grant beyond what this case needs. Throws with the
 * CLI's stderr if the key is not granted those scopes (e.g. `invalid_scope`).
 */
export async function loginForUserAdmin(cfg) {
  const tokenFile = join(mkdtempSync(join(tmpdir(), "thoryn-useradmin-")), "tokens.json");
  await runCli(cfg, isolatedEnv(tokenFile, { THORYN_API_KEY: cfg.cli.apiKey }), [
    "login", "--client-credentials",
    "--issuer", cfg.cli.issuer, "--gateway", cfg.cli.gateway,
    "--scope", "tenant:users.write tenant:users.read",
  ]);
  return tokenFile;
}

/**
 * Suspend the user with [email] via `thoryn users suspend --email … --confirm <workspace-slug>`
 * (the CLI resolves the email to its id through the directory, then POSTs the suspend). Throws with
 * the CLI's stderr on failure; the spec retries ONLY the directory-projection lag (a freshly
 * self-service-registered user not yet mirrored to product-api → "no user with email").
 */
export async function suspendUserByEmail(cfg, tokenFile, email) {
  await runCli(cfg, isolatedEnv(tokenFile), [
    "users", "suspend", "--email", email, "--confirm", cfg.cli.workspaceSlug, "--gateway", cfg.cli.gateway,
  ]);
}

/**
 * Diagnostic: return `thoryn users list` (unfiltered, JSON) for the isolated session, or a short error
 * string. Used only to enrich a "no user with email" failure so the run log shows whether the directory
 * is empty (a livemode/env-plane mismatch) or holds users under a different email/plane.
 */
export async function listUsersDiagnostic(cfg, tokenFile) {
  try {
    const { stdout } = await execFileP(
      "java",
      ["-jar", cfg.cli.jarPath, "users", "list", "--limit", "50", "--output", "json", "--gateway", cfg.cli.gateway],
      { env: isolatedEnv(tokenFile), timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.trim().slice(0, 2000);
  } catch (e) {
    return `users list failed: ${[e.stderr, e.stdout].map((s) => (s || "").toString().trim()).filter(Boolean).join(" | ") || e.message}`;
  }
}
