/**
 * SSO-2913 — Mailpit HTTP-API helpers (mirrors oathy e2e/scenario/lib/mailpit.ts,
 * the proven SSO-2816 capture). identity-service delivers the verification email
 * over SMTP to a Mailpit sink; these helpers read it back over Mailpit's REST API
 * (`GET /api/v1/messages` → newest first, then `GET /api/v1/message/{id}`) and
 * extract the `/verify-email?token=…` link — the email is genuinely delivered and
 * read back, never injected or read from the DB.
 *
 * The functions are pure fetches (no sleeping); the spec drives the wait with
 * Playwright's `expect.poll`, so it exits the instant the email lands.
 *
 * The link-extraction seam (extractVerificationLink) is pure and unit-tested in
 * lib/mailpit.parse.test.mjs — the one piece testable without a cluster.
 */
import type { APIRequestContext } from "@playwright/test";
import { extractVerificationLink } from "./verification-link.mjs";

export { extractVerificationLink };

interface MailpitSummary {
  ID: string;
  To?: Array<{ Address?: string }>;
  Subject?: string;
}

interface MailpitMessage {
  ID: string;
  Subject?: string;
  HTML?: string;
  Text?: string;
  To?: Array<{ Address?: string }>;
}

const norm = (addr: string): string => addr.trim().toLowerCase();

/** ID of the newest Mailpit message addressed to [recipient], or null if none yet. */
export async function findLatestMessageIdTo(
  request: APIRequestContext,
  mailpitBaseUrl: string,
  recipient: string,
): Promise<string | null> {
  const res = await request.get(`${mailpitBaseUrl}/api/v1/messages?limit=200`, {
    ignoreHTTPSErrors: true,
  });
  if (res.status() !== 200) return null;
  const body = (await res.json().catch(() => ({}))) as { messages?: MailpitSummary[] };
  const want = norm(recipient);
  const match = (body.messages ?? []).find((m) =>
    (m.To ?? []).some((t) => t.Address && norm(t.Address) === want),
  );
  return match?.ID ?? null;
}

/** Full message body (HTML preferred, Text fallback) by Mailpit message ID. */
export async function getMessageBody(
  request: APIRequestContext,
  mailpitBaseUrl: string,
  id: string,
): Promise<string> {
  const res = await request.get(`${mailpitBaseUrl}/api/v1/message/${id}`, {
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
  mailpitBaseUrl: string,
  recipient: string,
): Promise<string | null> {
  const id = await findLatestMessageIdTo(request, mailpitBaseUrl, recipient);
  if (id === null) return null;
  return extractVerificationLink(await getMessageBody(request, mailpitBaseUrl, id));
}
