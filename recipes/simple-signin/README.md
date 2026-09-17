# simple-signin

Provision a sandbox environment and a public OAuth client inside your workspace, then register a user
and sign them in to a protected page — the shortest path from "I have a Thoryn account" to "a user just signed in through it".

> **v3 (SSO-3092, epic SSO-3087):** two files. [`provision.yaml`](provision.yaml) is how to get Thoryn up
> and running for this example — copy it into your own `.thoryn/` and `thoryn provision apply` it, or let
> `thoryn examples apply simple-signin` converge it first. [`recipe.yaml`](recipe.yaml) is how to get the example
> configured: it references the provision file and adds the extra steps beyond the provisioning. Steps
> about `env.create` / `identity.registerUser` below describe v1.

## What it provisions

1. A **sandbox environment** in your workspace (`envSlug`; an existing sandbox with that slug is
   adopted, not re-created).
2. A **public loopback OAuth client** inside that sandbox (`clientType: public`, redirect
   `http://127.0.0.1/callback`).
3. A **demo user** inside that sandbox (its password comes from `DEMO_USER_PASSWORD`, never stored).

Then it **verifies** the client is `active`, and on teardown destroys what it created (child-first).

> **Why a sandbox (SSO-3131).** A sandbox never sends real transactional email: it captures it to the
> sandbox's **test-inbox** instead. The sign-up verification, password-reset and account-unlock emails
> this journey needs are all captured there (SSO-3026 / SSO-3079 / SSO-3135), and you read them with
> `thoryn env test-emails list --env <envSlug>`. So the example needs no email provider and never
> touches your workspace's real sender or production users.

## Run it

With the `thoryn` CLI:

```bash
thoryn examples setup simple-signin --set workspaceSlug=<your-ws>   # sandbox + client + demo user
thoryn examples run   simple-signin     # opens your browser: register a user, sign in, land on /protected
thoryn examples teardown simple-signin  # remove what setup created
```

The sign-in happens on the real hosted screens at your workspace's identity host; the local app is an
ephemeral loopback relying party.

### Run the relying party yourself (read the code)

The `thoryn examples run` command launches a built-in relying party so you can watch the flow with
zero setup. To see the same flow as **code you own**, run the readable Node.js app in
[`apps/loopback-rp/`](apps/loopback-rp/) with the issuer and client id the recipe printed:

```bash
cd apps/loopback-rp
THORYN_ISSUER=https://<your-workspace>.hub.<domain>/<envSlug> THORYN_CLIENT_ID=app-XXXXXXXX npm start
# open http://127.0.0.1:8471 and click "Sign in"
```

It is one dependency-free file — a good starting point for wiring Thoryn SSO into your own app.

## Notes

- No secret is printed to a pipe; a confidential client's secret would be written to a file. This
  example uses a **public** client (PKCE), so there is no secret.
- The `THORYN_ISSUER` is the **sandbox environment's** issuer (the workspace issuer plus `/<envSlug>`),
  not the workspace's own.
- Teardown removes what the provision file created. A user you registered yourself through the hosted
  sign-up is not in the receipt and stays in the sandbox.
