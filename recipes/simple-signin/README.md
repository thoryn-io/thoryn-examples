# simple-signin

Provision a workspace and a public OAuth client, then register a user and sign them in to a protected
page — the shortest path from "I have a Thoryn account" to "a user just signed in through it".

## What it provisions

1. A fresh, disposable **workspace** (`hub.createWorkspace`) — its slug defaults to
   `ex-signin-<random>` so runs don't collide.
2. A best-effort **product-api tenant registration** (`productApi.registerTenant`, idempotent).
3. A **public loopback OAuth client** under that workspace (`applications.create`,
   `clientType: public`, redirect `http://127.0.0.1/callback`). The hub auto-attaches the tenant's
   identity provider, so the client is immediately usable for sign-in.

Then it **verifies** the client is `active`, and on teardown **deletes** it.

## Run it

With the `thoryn` CLI:

```bash
thoryn examples setup simple-signin     # provision the workspace + client
thoryn examples run   simple-signin     # opens your browser: register a user, sign in, land on /protected
thoryn examples teardown simple-signin  # remove the client
```

The sign-in happens on the real hosted screens at your workspace's identity host; the local app is an
ephemeral loopback relying party (see [`apps/loopback-rp/`](apps/loopback-rp/)).

## Notes

- No secret is printed to a pipe; a confidential client's secret would be written to a file. This
  example uses a **public** client (PKCE), so there is no secret.
- Teardown is best-effort and removes only the OAuth client. A workspace and any user you registered
  currently have no customer-plane delete API (a tracked product gap).
