#!/usr/bin/env node
// @ts-check
'use strict';

/*
 * A minimal Thoryn relying-party (RP), in one readable file.
 * ----------------------------------------------------------
 * This is the app an end user signs in to. It runs a standard OpenID Connect
 * Authorization-Code flow with PKCE (RFC 7636) against your Thoryn workspace's
 * hub issuer, using the PUBLIC OAuth client that the `simple-signin` recipe
 * provisioned for you. There is no client secret — a public client proves itself
 * with PKCE instead.
 *
 * It intentionally uses ONLY the Node standard library (node:http, node:crypto,
 * node:url) so you can read the whole OIDC flow here without chasing framework
 * magic. In a real app you would use your framework's OIDC middleware; the five
 * routes below are exactly what that middleware does for you.
 *
 * The flow, end to end:
 *   GET /           public landing page with a "Sign in" link.
 *   GET /login      mint a fresh PKCE verifier + state, then 302 the browser to
 *                   {issuer}/oauth2/authorize.
 *   GET /callback   the hub redirects back here with ?code&state. We swap the
 *                   code for tokens at {issuer}/oauth2/token (sending the PKCE
 *                   verifier), start a session, and 302 to /protected.
 *   GET /protected  a page that only renders for a signed-in session; it shows
 *                   the claims from the ID token the hub issued.
 *   GET /logout     drop the session and go home.
 *
 * Configure it with three values from your recipe receipt / `thoryn` output:
 *   THORYN_ISSUER    e.g. https://ex-signin-ab12cd34.hub.stg.thoryn.org
 *   THORYN_CLIENT_ID e.g. app-XXXXXXXX  (the public client the recipe created)
 *   PORT             the loopback port to listen on (default 8471)
 *
 * The client was registered with redirect URI http://127.0.0.1/callback. Per
 * RFC 8252 §7.3 the hub ignores the port of a loopback redirect, so any local
 * port works — we just send http://127.0.0.1:{PORT}/callback.
 */

const http = require('node:http');
const crypto = require('node:crypto');

// ---- configuration ---------------------------------------------------------

const ISSUER = (process.env.THORYN_ISSUER || '').replace(/\/+$/, '');
const CLIENT_ID = process.env.THORYN_CLIENT_ID || '';
const SCOPE = process.env.THORYN_SCOPE || 'openid profile email';
const PORT = Number(process.env.PORT || 8471);

if (!ISSUER || !CLIENT_ID) {
  console.error(
    'Missing configuration. Set THORYN_ISSUER and THORYN_CLIENT_ID, e.g.:\n\n' +
      '  THORYN_ISSUER=https://<your-workspace>.hub.<domain> \\\n' +
      '  THORYN_CLIENT_ID=app-XXXXXXXX \\\n' +
      '  node server.js\n\n' +
      'Both values are printed by `thoryn examples apply simple-signin`\n' +
      '(and stored in the run receipt).',
  );
  process.exit(1);
}

const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

// ---- tiny in-memory state (single-process demo) ----------------------------
//
// `pending` maps an in-flight `state` value to its PKCE code_verifier, so the
// /callback can finish an authorization it started in /login. `sessions` maps an
// opaque session-id cookie to the signed-in user's ID-token claims. Both are
// plain Maps because this demo is a single local process; a real app would use
// a shared session store.

/** @type {Map<string, string>} */
const pending = new Map();
/** @type {Map<string, Record<string, unknown>>} */
const sessions = new Map();

// ---- PKCE helpers (RFC 7636) -----------------------------------------------

const base64url = (/** @type {Buffer} */ buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A high-entropy code_verifier: 32 random bytes, base64url-encoded. */
const newVerifier = () => base64url(crypto.randomBytes(32));

/** The S256 code_challenge derived from a verifier: base64url(SHA-256(verifier)). */
const challengeOf = (/** @type {string} */ verifier) =>
  base64url(crypto.createHash('sha256').update(verifier).digest());

/** An unguessable opaque token for `state` and session ids. */
const randomToken = () => base64url(crypto.randomBytes(24));

// ---- routes ----------------------------------------------------------------

/** GET / — public landing page. */
function landing(res) {
  send(
    res,
    200,
    page(
      'Example app',
      `<p>This is a demo relying party running locally on <code>http://127.0.0.1:${PORT}</code>.</p>
       <p>Its <a href="/protected">protected page</a> requires a signed-in user.</p>
       <p><a class="btn" href="/login">Sign in with Thoryn &rarr;</a></p>`,
    ),
  );
}

/**
 * GET /login — begin the Authorization-Code + PKCE flow.
 * We create a fresh verifier + state, remember the verifier under that state,
 * and redirect the browser to the hub's /oauth2/authorize with the derived
 * S256 challenge. Only the challenge travels over the front channel; the
 * verifier stays here and is revealed only on the back-channel token call.
 */
function login(res) {
  const verifier = newVerifier();
  const state = randomToken();
  pending.set(state, verifier);

  const authorize =
    `${ISSUER}/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challengeOf(verifier))}` +
    `&code_challenge_method=S256`;

  redirect(res, authorize);
}

/**
 * GET /callback — the hub redirects here after the user authenticates.
 * We validate `state` (CSRF + it ties us back to our verifier), exchange the
 * `code` for tokens at /oauth2/token, then start a session from the ID token.
 */
async function callback(res, url) {
  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description');
    return send(res, 400, page('Sign-in failed', `<p class="err">${esc(error)}${desc ? ': ' + esc(desc) : ''}</p><p><a href="/">Back</a></p>`));
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const verifier = state ? pending.get(state) : undefined;
  if (state) pending.delete(state); // one-time use
  if (!code || !verifier) {
    return send(res, 400, page('Sign-in failed', `<p class="err">Missing or unrecognized authorization response (state mismatch).</p><p><a href="/">Back</a></p>`));
  }

  const tokens = await exchangeCode(code, verifier);
  const idToken = tokens && typeof tokens.id_token === 'string' ? tokens.id_token : null;
  const claims = idToken ? decodeJwtClaims(idToken) : null;
  if (!claims) {
    return send(res, 502, page('Sign-in failed', `<p class="err">Token exchange did not return a usable ID token.</p><p><a href="/">Back</a></p>`));
  }

  // Start a session: a random id in an HttpOnly cookie, claims held server-side.
  const sid = randomToken();
  sessions.set(sid, claims);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
  redirect(res, '/protected');
}

/** GET /protected — renders only for a signed-in session. */
function protectedPage(res, req) {
  const claims = currentSession(req);
  if (!claims) return redirect(res, '/login');

  const subject = String(claims.email || claims.preferred_username || claims.sub || 'you');
  const rows = Object.entries(claims)
    .filter(([k]) => !['nonce', 'at_hash', 'c_hash'].includes(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</td></tr>`)
    .join('');

  send(
    res,
    200,
    page(
      'Protected page',
      `<p class="ok">&#10003; You are signed in as <strong>${esc(subject)}</strong>.</p>
       <p>This page is protected — it renders only because the OIDC flow completed and a valid ID token was issued by your tenant.</p>
       <h3>Your ID-token claims</h3>
       <table>${rows}</table>
       <p style="margin-top:1.5rem"><a href="/logout">Sign out</a></p>`,
    ),
  );
}

/** GET /logout — drop the session and return home. */
function logout(res, req) {
  const sid = cookie(req, 'sid');
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  redirect(res, '/');
}

// ---- back-channel token exchange -------------------------------------------

/**
 * Swap the authorization `code` for tokens at {issuer}/oauth2/token.
 * This is the back channel: we present the PKCE `code_verifier` here, proving we
 * are the same client that started the flow. A public client sends no secret.
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function exchangeCode(code, verifier) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  }).toString();

  const resp = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form,
  });
  if (!resp.ok) return null;
  return /** @type {Record<string, unknown>} */ (await resp.json().catch(() => null));
}

/**
 * Decode (WITHOUT verifying) the ID token's claims for display.
 *
 * NOTE: this demo trusts the ID token because it just came straight back from
 * the hub over TLS on the back channel we initiated. A production RP MUST verify
 * the JWT signature against the issuer's JWKS ({issuer}/oauth2/jwks), and check
 * `iss`, `aud`, `exp` and the `nonce`. Use a library (e.g. `jose`) for that.
 */
function decodeJwtClaims(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ---- HTTP plumbing ---------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    switch (url.pathname) {
      case '/': return landing(res);
      case '/login': return login(res);
      case '/callback': return await callback(res, url);
      case '/protected': return protectedPage(res, req);
      case '/logout': return logout(res, req);
      default: return send(res, 404, 'Not found', 'text/plain');
    }
  } catch (err) {
    send(res, 500, page('Something went wrong', `<p class="err">${esc(err && err.message ? err.message : String(err))}</p><p><a href="/">Back</a></p>`));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Example relying party listening on http://127.0.0.1:${PORT}`);
  console.log(`  issuer:    ${ISSUER}`);
  console.log(`  client_id: ${CLIENT_ID}`);
  console.log(`  redirect:  ${REDIRECT_URI}`);
  console.log('\nOpen http://127.0.0.1:' + PORT + ' in your browser and click "Sign in".');
});

/** @returns {Record<string, unknown> | null} the current session's claims, if any. */
function currentSession(req) {
  const sid = cookie(req, 'sid');
  return sid ? sessions.get(sid) || null : null;
}

/** Read one cookie value from the request's Cookie header. */
function cookie(req, name) {
  const raw = req.headers['cookie'] || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function send(res, status, body, contentType = 'text/html') {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8`, 'Content-Length': buf.length });
  res.end(buf);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The shared HTML shell — same look as the CLI's built-in demo RP. */
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; Thoryn example</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;color:#1a1a2e}
  h1{font-size:1.4rem;margin:0 0 1rem} h3{margin-top:2rem}
  a.btn{display:inline-block;background:#3d5afe;color:#fff;padding:.6rem 1rem;border-radius:8px;text-decoration:none;font-weight:600}
  code{background:#eef;padding:.1rem .35rem;border-radius:4px}
  table{border-collapse:collapse;width:100%;font-size:.9rem} td{border-bottom:1px solid #e6e6ef;padding:.4rem .5rem;vertical-align:top}
  td:first-child{font-weight:600;white-space:nowrap;color:#555}
  .ok{color:#0a7d33;font-size:1.1rem} .err{color:#b00020}
</style></head><body>
<h1>${esc(title)}</h1>
${body}
</body></html>`;
}
