/**
 * SSO-2909 / SSO-2913 — Mailpit HTTP-API helpers for the example e2e mail sink.
 *
 * The example journey configures the provisioned workspace's BYO-SMTP (SSO-2917)
 * to point at a SELF-HOSTED Mailpit instance running on a public host, so
 * identity-service delivers the verification email over real SMTP to that sink.
 * These helpers read it back over Mailpit's REST API and extract the
 * `/verify-email?token=…` link — the email is GENUINELY delivered and captured,
 * never injected or read from a DB. Mailpit is free and self-hosted (product-owner
 * decision).
 *
 * This mirrors oathy's proven capture (e2e/scenario/lib/mailpit.ts, SSO-2816):
 *
 *   Find:  GET {base}/api/v1/search?query=to:"<addr>"   (primary, ordering/size-independent)
 *          GET {base}/api/v1/messages?limit=200          (fallback, newest-first list)
 *   Body:  GET {base}/api/v1/message/{id}                (HTML preferred, Text fallback)
 *   Auth:  optional HTTP Basic (Mailpit `--ui-auth`), MAILPIT_API_USERNAME/PASSWORD
 *
 * Using the SEARCH API as the primary path is the SSO-2913 hardening: it filters
 * server-side and is independent of how many messages the sink has accumulated
 * across runs, avoiding the "newest email missed once the sink is full" flake that
 * the plain list scan suffers. It falls back to the list endpoint for an older
 * Mailpit build (or when search is disabled).
 *
 * The functions are pure fetches (no sleeping); the spec drives the wait with
 * Playwright's `expect.poll`, so it exits the instant the email lands.
 *
 * The link-extraction seam (extractVerificationLink) is pure and unit-tested in
 * lib/mailbox.parse.test.mjs — the one piece testable without a live sink.
 */
import type { APIRequestContext } from "@playwright/test";
import { extractVerificationLink } from "./verification-link.mjs";

export { extractVerificationLink };

/** Everything the Mailpit API needs: a public base URL + optional basic-auth. */
export interface MailpitConfig {
  /** Public https base URL of the Mailpit UI/API, e.g. `https://mail.example.org`. */
  baseUrl: string;
  /** Basic-auth username for a Mailpit `--ui-auth` deployment (optional). */
  username?: string;
  /** Basic-auth password for a Mailpit `--ui-auth` deployment (optional). */
  password?: string;
}

/** Minimal shape of a Mailpit message summary (`GET /api/v1/messages` / `/search`). */
interface MailpitSummary {
  ID: string;
  To?: Array<{ Address?: string }>;
  Subject?: string;
}

/** Minimal shape of a full Mailpit message (`GET /api/v1/message/{ID}`). */
interface MailpitMessage {
  ID: string;
  Subject?: string;
  HTML?: string;
  Text?: string;
  To?: Array<{ Address?: string }>;
}

const norm = (addr: string): string => addr.trim().toLowerCase();

function baseOf(cfg: MailpitConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

/** Optional Basic auth header for a Mailpit `--ui-auth` deployment. */
function authHeaders(cfg: MailpitConfig): Record<string, string> {
  if (cfg.username && cfg.password) {
    const token = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
    return { Authorization: `Basic ${token}` };
  }
  return {};
}

/**
 * Pure seam: pick the newest message ID addressed to [recipient] from a Mailpit
 * `messages` list. Mailpit returns both the list and the search endpoints
 * newest-first, so the first recipient match is the most recent email. The
 * recipient match is a defence-in-depth guard even when the search already
 * filtered server-side (search can also match other header fields).
 */
export function pickMessageIdTo(
  messages: MailpitSummary[] | undefined,
  recipient: string,
): string | null {
  const want = norm(recipient);
  const match = (messages ?? []).find((m) =>
    (m.To ?? []).some((t) => t.Address && norm(t.Address) === want),
  );
  return match?.ID ?? null;
}

/**
 * ID of the NEWEST Mailpit message addressed to [recipient], or null if none yet.
 *
 * Primary path is Mailpit's SEARCH API (`GET /api/v1/search?query=to:"…"`), which
 * filters server-side and is independent of how many messages the sink holds
 * across runs (the SSO-2913 fix). Falls back to the full-list scan when search is
 * unavailable (non-200), so an older Mailpit build still works. Both endpoints
 * return `messages` newest-first; `pickMessageIdTo` keeps the recipient match as a
 * guard either way.
 */
export async function findLatestMessageIdTo(
  request: APIRequestContext,
  cfg: MailpitConfig,
  recipient: string,
): Promise<string | null> {
  const headers = authHeaders(cfg);
  // Mailpit search grammar: `to:"addr"` scopes the query to the To header.
  const query = encodeURIComponent(`to:"${recipient}"`);
  const searchRes = await request
    .get(`${baseOf(cfg)}/api/v1/search?query=${query}&limit=50`, {
      headers,
      ignoreHTTPSErrors: true,
    })
    .catch(() => null);
  if (searchRes && searchRes.status() === 200) {
    const body = (await searchRes.json().catch(() => ({}))) as { messages?: MailpitSummary[] };
    return pickMessageIdTo(body.messages, recipient);
  }

  // Fallback: full-list scan (older Mailpit / search disabled). Newest-first, size-bounded.
  const listRes = await request
    .get(`${baseOf(cfg)}/api/v1/messages?limit=200`, { headers, ignoreHTTPSErrors: true })
    .catch(() => null);
  if (!listRes || listRes.status() !== 200) return null;
  const body = (await listRes.json().catch(() => ({}))) as { messages?: MailpitSummary[] };
  return pickMessageIdTo(body.messages, recipient);
}

/** Full message body (HTML preferred, Text fallback) by Mailpit message id. */
export async function getMessageBody(
  request: APIRequestContext,
  cfg: MailpitConfig,
  id: string,
): Promise<string> {
  const res = await request.get(`${baseOf(cfg)}/api/v1/message/${id}`, {
    headers: authHeaders(cfg),
    ignoreHTTPSErrors: true,
  });
  if (res.status() !== 200) return "";
  const msg = (await res.json().catch(() => ({}))) as MailpitMessage;
  return `${msg.HTML ?? ""}\n${msg.Text ?? ""}`;
}

/**
 * One-shot: find the newest verification email to [recipient] and return its verify
 * link, or null if it hasn't arrived yet. Wrap in `expect.poll`.
 */
export async function findVerificationLink(
  request: APIRequestContext,
  cfg: MailpitConfig,
  recipient: string,
): Promise<string | null> {
  const id = await findLatestMessageIdTo(request, cfg, recipient);
  if (id === null) return null;
  return extractVerificationLink(await getMessageBody(request, cfg, id));
}
