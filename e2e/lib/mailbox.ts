/**
 * SSO-2909 / SSO-2913 — Mailtrap Email Testing HTTP-API helpers.
 *
 * The example journey configures the provisioned workspace's BYO-SMTP (SSO-2917)
 * to point at a Mailtrap Email Testing inbox, so identity-service delivers the
 * verification email over real SMTP to that managed sink. These helpers read it
 * back over Mailtrap's REST API and extract the `/verify-email?token=…` link — the
 * email is GENUINELY delivered and captured, never injected or read from a DB.
 *
 * This is the managed-service analogue of oathy's Mailpit capture (e2e/scenario/
 * lib/mailpit.ts, the proven SSO-2816 pattern): same "list newest → fetch body →
 * parse link" shape, adapted to Mailtrap's API.
 *
 *   List:  GET {api}/api/accounts/{accountId}/inboxes/{inboxId}/messages?search=…
 *   Body:  GET {api}/api/accounts/{accountId}/inboxes/{inboxId}/messages/{id}/body.html
 *          GET {api}/api/accounts/{accountId}/inboxes/{inboxId}/messages/{id}/body.txt
 *   Auth:  header `Api-Token: {apiToken}`
 *
 * The functions are pure fetches (no sleeping); the spec drives the wait with
 * Playwright's `expect.poll`, so it exits the instant the email lands.
 *
 * The link-extraction seam (extractVerificationLink) is pure and unit-tested in
 * lib/mailbox.parse.test.mjs — the one piece testable without live creds.
 */
import type { APIRequestContext } from "@playwright/test";
import { extractVerificationLink } from "./verification-link.mjs";

export { extractVerificationLink };

/** Everything the Mailtrap Email Testing API needs to locate an inbox. */
export interface MailtrapConfig {
  /** API origin, default https://mailtrap.io */
  apiBaseUrl: string;
  /** Numeric Mailtrap account id (the `/api/accounts/{id}` path segment). */
  accountId: string;
  /** Numeric Email-Testing inbox id. */
  inboxId: string;
  /** Email Testing API token (sent as the `Api-Token` header). */
  apiToken: string;
}

/** Minimal shape of a Mailtrap message summary (`GET …/messages`). */
interface MailtrapSummary {
  id: number;
  to_email?: string;
  subject?: string;
  sent_at?: string;
}

const norm = (addr: string): string => addr.trim().toLowerCase();

function messagesUrl(cfg: MailtrapConfig): string {
  return `${cfg.apiBaseUrl.replace(/\/+$/, "")}/api/accounts/${cfg.accountId}/inboxes/${cfg.inboxId}/messages`;
}

function authHeaders(cfg: MailtrapConfig): Record<string, string> {
  return { "Api-Token": cfg.apiToken, Accept: "application/json" };
}

/**
 * ID of the NEWEST Mailtrap message addressed to [recipient], or null if none yet.
 * Uses Mailtrap's server-side `search` to narrow, then guards with an exact
 * `to_email` match client-side (search also matches subject/from). Newest = the
 * highest numeric message id.
 */
export async function findLatestMessageIdTo(
  request: APIRequestContext,
  cfg: MailtrapConfig,
  recipient: string,
): Promise<string | null> {
  const res = await request.get(`${messagesUrl(cfg)}?search=${encodeURIComponent(recipient)}`, {
    headers: authHeaders(cfg),
    ignoreHTTPSErrors: true,
  });
  if (res.status() !== 200) return null;
  const list = (await res.json().catch(() => [])) as MailtrapSummary[];
  const want = norm(recipient);
  const match = (Array.isArray(list) ? list : [])
    .filter((m) => m.to_email && norm(m.to_email) === want)
    .sort((a, b) => b.id - a.id)[0];
  return match ? String(match.id) : null;
}

/** Full message body (HTML + text concatenated) by Mailtrap message id. */
export async function getMessageBody(
  request: APIRequestContext,
  cfg: MailtrapConfig,
  id: string,
): Promise<string> {
  const base = `${messagesUrl(cfg)}/${id}`;
  const [html, text] = await Promise.all([
    request
      .get(`${base}/body.html`, { headers: authHeaders(cfg), ignoreHTTPSErrors: true })
      .then((r) => (r.status() === 200 ? r.text() : ""))
      .catch(() => ""),
    request
      .get(`${base}/body.txt`, { headers: authHeaders(cfg), ignoreHTTPSErrors: true })
      .then((r) => (r.status() === 200 ? r.text() : ""))
      .catch(() => ""),
  ]);
  return `${html}\n${text}`;
}

/**
 * One-shot: find the newest verification email to [recipient] and return its verify
 * link, or null if it hasn't arrived yet. Wrap in `expect.poll`.
 */
export async function findVerificationLink(
  request: APIRequestContext,
  cfg: MailtrapConfig,
  recipient: string,
): Promise<string | null> {
  const id = await findLatestMessageIdTo(request, cfg, recipient);
  if (id === null) return null;
  return extractVerificationLink(await getMessageBody(request, cfg, id));
}
