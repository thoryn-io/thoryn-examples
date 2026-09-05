# Releasing the catalog

The `thoryn` CLI (`thoryn examples update`) consumes a **signed** catalog bundle from this repo's
GitHub releases (SSO-2874). The `.github/workflows/release.yml` workflow builds and signs it.

## One-time setup

Store the Ed25519 **private** signing key as the repo secret `THORYN_EXAMPLES_SIGNING_KEY`
(the CLI has the matching **public** key baked in as its pinned trust anchor):

```bash
gh secret set THORYN_EXAMPLES_SIGNING_KEY --repo thoryn-io/thoryn-examples < private.pem
```

## Cutting a release

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The workflow validates every recipe against the schema, builds a deterministic `catalog.zip`
(shipping `recipe.json` generated from each authored `recipe.yaml`), signs it with the key
(`openssl pkeyutl -sign -rawin` → `catalog.zip.sig`), and attaches both to the `v1.0.0` release.

Rotating the key means updating the CLI's pinned public key — a CLI release.
