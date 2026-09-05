# loopback relying-party app (placeholder)

`simple-signin` needs a tiny local OAuth relying party: it starts an ephemeral server on
`127.0.0.1`, opens your browser to the authorization endpoint, completes the PKCE code flow on the
callback, and renders a `/protected` page from the ID-token claims.

Today that relying party is **provided by the `thoryn` CLI itself** (its built-in loopback RP), so
this directory is a placeholder. A later phase moves the runnable RP here as a pinned, checksummed
recipe **asset** the CLI launches, so the example is fully self-describing in this repo.

Until then, run the example with the CLI:

```bash
thoryn examples setup simple-signin && thoryn examples run simple-signin
```
