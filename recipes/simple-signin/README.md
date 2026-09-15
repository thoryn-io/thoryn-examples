# simple-signin

Provision a workspace and a public OAuth client, then register a user and sign them in to a protected
page — the shortest path from "I have a Thoryn account" to "a user just signed in through it".

> **v3 (SSO-3092, epic SSO-3087):** two files. [`provision.yaml`](provision.yaml) is how to get Thoryn up
> and running for this example — copy it into your own `.thoryn/` and `thoryn provision apply` it, or let
> `thoryn examples apply simple-signin` converge it first. [`recipe.yaml`](recipe.yaml) is how to get the example
> configured: it references the provision file and adds the extra steps beyond the provisioning. Steps
> about `env.create` / `identity.registerUser` below describe v1.

## What it provisions

1. A **public loopback OAuth client** in your workspace (`applications.create`, `clientType: public`,
   redirect `http://127.0.0.1/callback`), on the environment you select — production by default, so
   the sign-up verification email goes out over your workspace's real sender.

Then it **verifies** the client is `active`, and on teardown **deletes** it.

## Run it

With the `thoryn` CLI:

```bash
thoryn examples setup simple-signin     # provision the workspace + client
thoryn examples run   simple-signin     # opens your browser: register a user, sign in, land on /protected
thoryn examples teardown simple-signin  # remove the client
```

The sign-in happens on the real hosted screens at your workspace's identity host; the local app is an
ephemeral loopback relying party.

### Run the relying party yourself (read the code)

The `thoryn examples run` command launches a built-in relying party so you can watch the flow with
zero setup. To see the same flow as **code you own**, run the readable Node.js app in
[`apps/loopback-rp/`](apps/loopback-rp/) with the issuer and client id the recipe printed:

```bash
cd apps/loopback-rp
THORYN_ISSUER=https://<your-workspace>.hub.<domain> THORYN_CLIENT_ID=app-XXXXXXXX npm start
# open http://127.0.0.1:8471 and click "Sign in"
```

It is one dependency-free file — a good starting point for wiring Thoryn SSO into your own app.

## Notes

- No secret is printed to a pipe; a confidential client's secret would be written to a file. This
  example uses a **public** client (PKCE), so there is no secret.
- Teardown is best-effort and removes only the OAuth client. A workspace and any user you registered
  currently have no customer-plane delete API (a tracked product gap).
