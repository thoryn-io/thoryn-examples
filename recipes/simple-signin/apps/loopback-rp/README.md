# loopback relying-party app

A tiny OpenID Connect **relying party** (the app a user signs in to), written in one
readable file of Node.js with **no dependencies** — just the standard library. It runs the
standard **Authorization Code + PKCE** flow against your Thoryn workspace's hub issuer using
the **public** OAuth client that the [`simple-signin`](../../) recipe provisions.

Read [`server.js`](server.js) top to bottom: the five routes are exactly what an OIDC
middleware does for you, spelled out so you can see the whole flow.

## The flow

```
GET /           public landing page with a "Sign in" link
GET /login      mint a PKCE verifier + state, 302 to {issuer}/oauth2/authorize
GET /callback   hub returns ?code&state → exchange the code at {issuer}/oauth2/token
                (sending the PKCE verifier), start a session, 302 to /protected
GET /protected  renders only for a signed-in session; shows the ID-token claims
GET /logout     RP-Initiated Logout: drop the local session, then 302 to the hub's
                end_session_endpoint (id_token_hint + post_logout_redirect_uri) so
                the Thoryn session ends too; the hub redirects back to /
```

Only the PKCE **challenge** travels over the browser (front channel); the **verifier** stays
in the app and is revealed only on the back-channel token call — that is what lets a public
client (no secret) authenticate safely.

## Signing out

`/logout` performs **[OpenID Connect RP-Initiated Logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)**,
not just a local cookie drop. Clearing only this app's session would leave you signed in at the
hub, so the next **Sign in** would re-authenticate silently with no prompt. Instead the app
keeps the `id_token` from the token exchange, and on `/logout` it clears the local session and
then redirects the browser to the hub's `end_session_endpoint` (discovered from
`{issuer}/.well-known/openid-configuration`) with:

- `id_token_hint` — the stored ID token, telling the hub which session to end;
- `post_logout_redirect_uri` — `http://127.0.0.1:{PORT}/`, where the hub returns you afterwards;
- `state` — an unguessable value.

The hub ends its session and redirects back to the loopback origin, fully signed out. For that
redirect-back to be allowed, the recipe registers `postLogoutRedirectUris: ["http://127.0.0.1/"]`
on the client (port-agnostic per RFC 8252, mirroring the redirect URI). If no `id_token` is on
the session, the app falls back to a local-only logout so signing out never errors.

## Run it

You need [Node.js](https://nodejs.org) 18+ and a client from the recipe. Apply the recipe
first (it prints the issuer and client id, and stores them in the run receipt):

```bash
thoryn examples apply simple-signin
```

Then start this app with those two values:

```bash
cd recipes/simple-signin/apps/loopback-rp
THORYN_ISSUER=https://<your-workspace>.hub.<domain> \
THORYN_CLIENT_ID=app-XXXXXXXX \
npm start
```

Open <http://127.0.0.1:8471>, click **Sign in with Thoryn**, complete the hosted sign-in, and
you land on `/protected` showing your ID-token claims.

## Configuration

| Env var | Required | Default | Description |
|---|---|---|---|
| `THORYN_ISSUER` | yes | — | Your workspace's hub issuer, e.g. `https://ex-signin-ab12cd34.hub.stg.thoryn.org`. |
| `THORYN_CLIENT_ID` | yes | — | The public client id the recipe created, e.g. `app-XXXXXXXX`. |
| `THORYN_SCOPE` | no | `openid profile email` | Requested scopes. |
| `PORT` | no | `8471` | Local loopback port to listen on. |

The client is registered with redirect URI `http://127.0.0.1/callback`. Per
[RFC 8252 §7.3](https://www.rfc-editor.org/rfc/rfc8252#section-7.3) the hub ignores the port
of a loopback redirect, so any local port works — the app sends
`http://127.0.0.1:{PORT}/callback`.

## How this relates to the CLI

`thoryn examples run simple-signin` today launches an equivalent relying party built into the
CLI, so you can watch the flow with zero setup. This directory is the same flow as **code you
own and can read** — the CLI will launch this asset directly in a later release so there is a
single source of truth.

## Production note

For clarity this demo **decodes** the ID token without verifying it — safe here only because
the token comes straight back from the hub over TLS on the back channel the app initiated. A
real relying party **must verify** the JWT signature against the issuer's JWKS
(`{issuer}/oauth2/jwks`) and check `iss`, `aud`, `exp`, and the `nonce`. Use an OIDC library
(for Node, [`jose`](https://github.com/panva/jose) or a full client like
[`openid-client`](https://github.com/panva/openid-client)) rather than hand-rolling that.
