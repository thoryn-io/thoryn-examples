/**
 * SSO-3081 — drive a user SUSPEND through the supported `thoryn users` CLI surface, so the
 * simple-signin negative e2e can assert the suspended-login branch WITHOUT a raw API call / DB
 * patch (the product-boundary rule).
 *
 * A fresh self-service user is registered in-browser by the spec; to suspend it we shell out to the
 * SAME `thoryn.jar` the workflow uses, but authenticate a SEPARATE client-credentials session into an
 * ISOLATED token store (its own HOME) requesting only `tenant:users.{write,read}`. That isolation
 * means: (a) a missing scope grant on the CI key fails only this one test, not the whole suite, and
 * (b) the provisioning session the teardown step reuses is never clobbered. The suspend is
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

/**
 * Authenticate a client-credentials session for user administration into an ISOLATED token store,
 * returning the HOME dir that store lives under (passed back into [suspendUserByEmail]). Requests
 * only the two user scopes so it never widens the CI key's effective grant beyond what this case needs.
 */
export async function loginForUserAdmin(cfg) {
  const home = mkdtempSync(join(tmpdir(), "thoryn-useradmin-"));
  await execFileP(
    "java",
    [
      "-jar", cfg.cli.jarPath, "login", "--client-credentials",
      "--issuer", cfg.cli.issuer, "--gateway", cfg.cli.gateway,
      "--scope", "tenant:users.write tenant:users.read",
    ],
    { env: { ...process.env, HOME: home, THORYN_CI_PLAINTEXT_TOKENS: "1", THORYN_API_KEY: cfg.cli.apiKey }, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return home;
}

/**
 * Suspend the user with [email] via `thoryn users suspend --email … --confirm <workspace-slug>`
 * (the CLI resolves the email to its id through the directory, then POSTs the suspend). Rejects on a
 * non-zero exit; the spec wraps it in `expect.poll` so a directory-projection lag (the freshly
 * self-service-registered user not yet mirrored to product-api) is retried rather than flaking.
 */
export async function suspendUserByEmail(cfg, home, email) {
  await execFileP(
    "java",
    [
      "-jar", cfg.cli.jarPath, "users", "suspend",
      "--email", email, "--confirm", cfg.cli.workspaceSlug, "--gateway", cfg.cli.gateway,
    ],
    { env: { ...process.env, HOME: home, THORYN_CI_PLAINTEXT_TOKENS: "1" }, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
}
