# SSO-2912 — Published-stack example e2e (plan + feasibility + blockers)

> **Status: SCAFFOLD / NOT-YET-FUNCTIONAL.** This document, the
> `.github/workflows/example-e2e.yml` workflow skeleton, and the `e2e/`
> Playwright harness are a reviewable *plan and skeleton*. They have **not** been
> run against a live cluster, and — per the feasibility findings below — **cannot
> go green today** without cross-repo work (chart changes in `t-cloud-packaging`
> and an `application-production.yml` in `oathy`) plus a human-created repo
> secret. The value here is the concrete plan, the skeleton, and an honest
> blocker list — not a working pipeline.

Epic: **SSO-2906** — use the `thoryn` CLI in thoryn-examples' own CI to deploy the
example and run a browser e2e that captures the real verification email so the
flow can proceed. Harness ticket: **SSO-2909**. Mailpit capture pattern:
SSO-2913 (mirrors oathy SSO-2816). WIF auth: **SSO-2910** (oathy #3447, pending).

---

## 1. What we want (settled decisions from the epic)

The thoryn-examples workflow glues the pieces (orchestration Option B):

1. Bring up a browsable k3d cluster (ingress-nginx + cert-manager + CoreDNS
   split-horizon at `*.127.0.0.1.nip.io`), + Mailpit test-SMTP.
2. Deploy the **published product** — released ghcr images via the packaged
   **t-cloud-packaging `thoryn-hub` chart** (NOT an oathy-from-source build).
3. `thoryn login --workload-identity` (GitHub OIDC → hub WIF, SSO-2910).
4. `thoryn examples apply simple-signin` (provision workspace + public OAuth
   client + a user), capturing the issuer + client-id it prints.
5. Start the standalone loopback RP (`recipes/simple-signin/apps/loopback-rp/server.js`).
6. Run a Playwright harness that drives **Path B (email capture)**: a genuine
   self-service sign-up → capture the verification email from Mailpit → verify →
   sign in through the loopback RP → assert the protected page.
7. `thoryn examples teardown simple-signin` → tear down the cluster.

---

## 2. Feasibility verdict

**Can the published product be deployed browsably from thoryn-examples CI today?
No — not against the packaged `t-cloud-packaging` chart as it currently stands.**

The packaged `thoryn-hub` chart is an honest, self-described **v0.1.0
"productization baseline" that lints and renders but has never been deployed**
(`t-cloud-packaging/docs/gaps.md`, gap #7: *"Never deployed to a real CCE"*).
Several of its gaps each *independently* block a working browsable OAuth journey,
before we even get to the browsable affordances. Details per-affordance in §3–§5.

The workflow + harness in this PR are therefore written to the *intended* shape,
with every unresolved dependency marked `# BLOCKED(SSO-2912): …` in the workflow.
Turning them green is gated on the blocker list in §7.

**Two honest paths forward** (a product-owner decision — see §8):

- **(A) Make the packaged chart deployable (preferred, true to "validate the
  shipped artifact").** Land the `t-cloud-packaging` + `oathy` changes in §7 so a
  customer-shaped `helm install` of `thoryn-hub` actually boots and completes an
  OIDC code flow. Then this example validates the real published product.
- **(B) Vendor oathy's browsable overlay into the example repo.** Faster to green,
  but it means the example deploys *oathy's internal browsable stack*, not the
  packaged product — which contradicts the epic's "deploy the published chart as a
  customer would." Not recommended except as a temporary bridge.

---

## 3. Per-affordance: what the packaged chart exposes vs. what lives only in oathy

The browsable-stack affordances the e2e needs, and where each lives today:

| Affordance | Packaged `thoryn-hub` chart | oathy `values-local.yaml` / templates | Verdict for the example |
|---|---|---|---|
| **nip.io issuer / publicBaseUrl** | `hub.publicBaseUrl` value (→ `OAUTHY_HUB_PUBLIC_BASE_URL`); `identity.publicBaseUrl`; `ingress.hosts.{hub,identity,api}` | issuer via `SPRING_SECURITY_OAUTH2_AUTHORIZATIONSERVER_ISSUER` + `OAUTHY_TENANCY_PLATFORM_DOMAIN` + `OAUTHY_TENANCY_DEFAULT_TENANT_HOSTS` | **Partial.** The chart takes hostnames as values, but wires them to **different env keys** than the images actually read under a non-staging profile (gap #2). The apex-host→default-tenant mapping (`OAUTHY_TENANCY_DEFAULT_TENANT_HOSTS`) has no chart value; must be injected via free-form `hub.env` — see §4. |
| **Ingress** | `ingress.enabled`, `className`, `hosts.*`, TLS block (chart-native) | `hub.ingress.*` (internal chart) | **Chart exposes it.** `ingress.hosts.{hub,identity,api}` = the nip.io hosts. Good. |
| **CoreDNS split-horizon rewrite** | Not chart concern | Applied by `k3d-e2e.sh` / `deploy-smoke-test.yml` as a raw `coredns-custom` ConfigMap | **Example-repo CI step.** Cluster-level, chart-independent. Port the ConfigMap into `example-e2e.yml`. |
| **Self-signed ingress TLS trust into the hub JVM truststore** | **Absent.** No `extraCaTrustSecret`, no `ca-trust` init container, no `localSelfSignedTls` cert templates | `hub.extraCaTrustSecret` + a temurin `ca-trust` init container + `hub/identity/api-gateway-local-selfsigned-cert.yaml` (cert-manager `Certificate`s with matching SANs) + `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=…` | **Gap.** The hub's back-channel federation TLS call to `https://identity.127.0.0.1.nip.io` needs to trust the ingress self-signed CA, or the handshake fails → `federation_unavailable`. The packaged chart has **no** init-container/truststore affordance and **no** stable-SAN self-signed cert templates. Must be **added to the packaged chart** (t-cloud-packaging change) or worked around (Path B). |
| **Mailpit SMTP wiring (`STUB_SMTP_HOST=thoryn-mailpit:1025`)** | Not chart concern; identity SMTP env is free-form `identity.env` | `k3d-e2e.sh` seeds a `thoryn-smtp-credentials` stub Secret + Mailpit raw manifest | **Example-repo CI step + `identity.env`.** Deploy Mailpit (raw manifest, vendored from oathy `scripts/local-e2e/mailpit.yaml`), and point identity's `SPRING_MAIL_HOST/PORT` at it via `identity.env`. The chart passes `identity.env` through, so this is feasible. |
| **`OAUTHY_FLYWAY_CONFORMANCE_WIF_AUDIENCE=https://hub.127.0.0.1.nip.io`** | Not present | Not in `values-local.yaml` today; per the epic this is **oathy V148 / #3447 (pending)** — makes the WIF audience per-environment so the k3d hub issuer is accepted | **Blocked upstream.** Inject via `hub.env` once the hub image carries V148. The `conformance-ci-github-wif` client is subject-pinned to `thoryn-io/thoryn-examples` (V145). Until #3447 lands, the WIF audience is fixed to the staging hub issuer and a k3d hub issuer will be rejected. |
| **`seedDemo` (identity federation-member secret)** | Not present; the packaged chart's `_helpers.tpl` explicitly *removes* the staging macro and demo seeds | `OAUTHY_FLYWAY_SEED_DEMO=true` (seeds the hub↔identity federation member `{noop}hub-secret` via V17) | **Gap.** The default-tenant hub→identity federation member needs its client-secret seeded, or federation-start 401s. Inject via `hub.env` **iff** the published image still honors `OAUTHY_FLYWAY_SEED_DEMO` under a `production` profile (unverified — the chart deliberately drops demo seeds; see gap). |
| **Tenancy: workspace = a new tenant** | `tenancy.mode: single` **default** | multi-issuer broker | **Must set `tenancy.mode: multi`.** The recipe's `hub.createWorkspace` provisions a *new tenant*; that is the multi-tenant broker path. The chart has the toggle, but gap #4 (*"single-tenant honored end-to-end"* — and by symmetry the multi path under `production`) is unverified against the published image. |
| **Redis** | Bundled single Redis on **6379 + password** (`redis.existingSecret`), no ACL, no TLS | TLS-only Redis on **6380** + per-service ACL | **Divergent — actually simpler.** Do **not** copy `values-local.yaml`'s 6380/TLS redis env; the packaged bundled Redis is plaintext 6379 with a password. The images must accept `default`-user + password (unverified under `production`). |
| **Postgres** | Bundled single StatefulSet with **one** DB (`database.name`, default `thoryn`) | three DBs: `oauthy`, `product_api`, `identity` | **Gap.** hub, product-api and identity each own a **separate** database/schema in oathy. The packaged bundled Postgres creates only one `POSTGRES_DB`. Three services sharing one DB will collide on Flyway/migrations. Needs an external Postgres with three DBs **or** a chart change to the bundled Postgres. |
| **OpenBao signing keys** | Bundled OpenBao is a **bare** `openbao/openbao:2.1` Deployment — **no init job, no Transit mount, no `sas-ecdsa-jwt-key` provisioning** (gap #3) | staging OpenBao init provisions Transit + ES256 keys | **Hard blocker.** The hub's `VaultKeyBootstrap` needs Transit + the signing key at startup or it crashes and never becomes Ready (the known pr-preview gotcha). The packaged chart provisions **nothing**. A signing-key init job must be added to the packaged chart (t-cloud-packaging change). |

**Bottom line for §3:** the *cluster-level* affordances (CoreDNS, Mailpit,
ingress-nginx, cert-manager) are portable into the example-repo CI. The
*chart-level* affordances that make the OAuth journey actually work — self-signed
CA trust into the hub truststore, signing-key provisioning, three databases, the
federation-member seed, the `production` Spring profile itself — are **absent from
the packaged chart** and either need to be added there or the example must fall
back to Path (B).

---

## 4. Env-key reconciliation (gap #2, the sharp edge)

The packaged chart hardcodes env keys **modelled on** the internal chart but not
yet reconciled 1:1 with what the images read (`t-cloud-packaging/docs/gaps.md`
#1–#2). Concretely, the chart emits:

- `SPRING_PROFILES_ACTIVE = production` (via `thoryn.prodEnv`) — but the services
  ship only `application-staging.yml`; **no `application-production.yml` exists in
  identity/product-api/api-gateway yet** (gap #1). Under `production` they boot on
  bare defaults, missing the federation/tenant-host/redirect config that
  `application-staging.yml` supplies.
- `OAUTHY_HUB_PUBLIC_BASE_URL`, `OAUTHY_TENANCY_DEFAULT_TENANT`,
  `THORYN_IDENTITY_SERVICE_URL`, `THORYN_TENANCY_MODE`,
  `OAUTHY_IDENTITY_PUBLIC_BASE_URL` — these key **names** must be confirmed against
  what the images actually read; oathy's running deployment uses
  `SPRING_SECURITY_OAUTH2_AUTHORIZATIONSERVER_ISSUER`,
  `OAUTHY_TENANCY_PLATFORM_DOMAIN`, `OAUTHY_TENANCY_DEFAULT_TENANT_HOSTS`, etc.

**Constraint:** free-form `hub.env` / `identity.env` are appended **after** the
hardcoded keys. Helm renders duplicates happily, but **Server-Side Apply rejects a
duplicate env key** on `helm upgrade` (CLAUDE.md / SSO-1775). So we can inject
*new* keys via `*.env`, but we **cannot override** a chart-hardcoded key by
re-declaring it. Any key the chart hardcodes *wrongly* for our purposes has to be
fixed **in the chart**, not overridden from the example.

This is why "just pass the right env from the example overlay" is **not**
sufficient: some of the wiring is chart-hardcoded and some of the behaviour
(the `production` profile) is image-side.

---

## 5. Images: names, tags, publication

- **oathy publishes to `ghcr.io/thoryn-io/<service>:<tag>`** on push to `main`,
  where `<service>` ∈ `authorization-hub`, `identity-service`, `product-api`,
  `api-gateway` (`.github/workflows/docker-publish.yml`). Tags are **per-service
  content SHAs** (SSO-1459), computed from each service's content closure — there
  is **no floating `latest`** and **no semver release tag** like `2026.06`.
- **Chart image names differ:** the chart expects `thoryn-hub`,
  `thoryn-identity-service`, `thoryn-product-api`, `thoryn-api-gateway` (the SWR
  mirror names). To pull straight from ghcr the example must override each
  `<service>.image.name` to the ghcr name (`hub.image.name=authorization-hub`,
  `identity.image.name=identity-service`, …) and set
  `global.image.registry=ghcr.io/thoryn-io`.
- **VERSION-MATRIX.md digests are all `<sha256:TBD>`** — the chart pins nothing
  real yet. The example CI must resolve a concrete per-service tag (content SHA)
  for each image, e.g. via `gh api` against the ghcr package versions, or the
  product owner must pin real digests in VERSION-MATRIX + the chart.
- **ghcr package visibility is unverified.** oathy's docker-publish pushes with
  `GITHUB_TOKEN`; the packages may be **private**. If so the example needs a PAT /
  GitHub App with `read:packages` on `thoryn-io` (mirrors the existing
  `OATHY_CLI_TOKEN` used by `conformance.yml`) plus a k3d registry pull secret.
- **mailpit** (`axllent/mailpit:latest`) is a public Docker Hub image — pullable.

---

## 6. The `thoryn` CLI is a jar, not a native binary (for CI)

The existing `conformance.yml` **downloads the prebuilt `thoryn.jar`** from the
latest `cli-v*` release of `thoryn-io/oauthy` (using `OATHY_CLI_TOKEN`) and runs
it with `java -jar thoryn.jar` on `actions/setup-java@v4` (Temurin 21). GraalVM
native-image binaries exist for distribution but **CI uses the jar** — no build
from source. `example-e2e.yml` reuses that exact pattern, so the CLI is a solved
dependency (given `OATHY_CLI_TOKEN`).

Verb note: `conformance.yml` uses `thoryn examples apply|verify|teardown`; the
recipe README uses `thoryn examples setup|teardown`. The workflow uses the
`apply/verify/teardown` verbs that the repo's own conformance CI already exercises,
and treats the `setup` alias as unverified.

---

## 7. Blocker list (what must be resolved before this CI can go green)

Actionable, grouped by owner. **Cross-repo items are called out — do not change
those repos from here.**

### Must-fix in `t-cloud-packaging` (chart) — cross-repo
1. **OpenBao signing-key init job.** Bundled OpenBao provisions no Transit mount
   / signing key → the hub's `VaultKeyBootstrap` crashes → hub never Ready. Add a
   dev-mode init job (port a clean version of oathy's `vault-init-job`). (gap #3)
2. **Bundled Postgres must create three databases** (`oauthy`, `product_api`,
   `identity`) — or the example must supply an external Postgres with all three.
   One shared `thoryn` DB collides across services.
3. **Self-signed CA trust for the hub's federation back-channel.** Add an
   `extraCaTrustSecret` + `ca-trust` init container (+ stable-SAN self-signed cert
   templates, or reuse ingress-nginx's), or the hub↔identity HTTPS handshake fails
   under the browsable stack.
4. **Env-key reconciliation** so the chart's hardcoded keys match what the images
   read (gap #2), *especially* whichever key carries the apex-host→default-tenant
   mapping and the issuer.

### Must-fix in `oathy` (image/profile) — cross-repo
5. **`application-production.yml` for identity / product-api / api-gateway**
   (gap #1) — or a documented decision that the example runs the images under the
   `staging` profile. Without a real `production` profile the services boot on
   defaults and the OIDC journey can't complete.
6. **WIF per-environment audience — oathy V148 / #3447 (pending).** Until it
   lands, the k3d hub issuer `https://hub.127.0.0.1.nip.io` is not an accepted WIF
   audience and `thoryn login --workload-identity --issuer https://hub.127.0.0.1.nip.io`
   is rejected.
7. **Confirm `OAUTHY_FLYWAY_SEED_DEMO` (and the federation-member seed) is honored
   under the published profile**, or provide a product path to seed the
   default-tenant hub↔identity federation member.

### Must-provision in `thoryn-examples` (this repo / org) — human action
8. **`THORYN_CI_WIF_SIGNING_KEY`** repo secret (PKCS#8 / EC P-256 PEM — the
   private half of the `conformance-ci-github-wif` client). A human must create
   this; the same secret the existing `conformance.yml` documents.
9. **`OATHY_CLI_TOKEN`** repo secret (already used by `conformance.yml`) — reads
   oathy releases for the CLI jar, and (if ghcr packages are private) reused /
   extended with `read:packages` to pull the images.

### Runner capacity — this repo
10. **A full k3d stack (hub + identity + product-api + api-gateway + bundled
    postgres/redis/openbao + ingress-nginx + cert-manager + Mailpit + the browser)
    is heavy for `ubuntu-latest` (2 vCPU / 7 GB).** oathy runs the equivalent on a
    beefy `[self-hosted, hetzner]` runner precisely because it flaked
    (ImagePullBackOff / Spring startup-probe timeout) on small GitHub-hosted
    runners (`deploy-smoke-test.yml` header). thoryn-examples has **no self-hosted
    runner**. Options: a larger GitHub-hosted runner (`ubuntu-latest-4-core` /
    bigger), a self-hosted runner for this repo, or accept nightly-only + generous
    timeouts. **This is an open decision.**

### Journey correctness — verify on the live run
11. **Path-B account reuse across tenants (open question).** oathy's proven
    hosted-signup captures the email on the **default-tenant identity host**
    (`identity.127.0.0.1.nip.io`) and lands sign-in at the **console**. Our example
    wants the user to then sign in through the **workspace tenant's** hub issuer to
    the loopback RP. Whether a user self-registered on the default-tenant identity
    can authenticate through the *workspace* tenant's hub federation (same shared
    identity-service member, different initiating issuer) is **unverified** — it is
    the single most important thing a live run must confirm. If it doesn't hold,
    the sign-up must happen on the workspace tenant's own `/register` surface — and
    whether a tenant-subdomain self-service `/register` exists for a provisioned
    workspace is itself unconfirmed (memory notes identity login is Host-scoped and
    the tenant→domain mapping is empty in staging → falls back to `default`).

---

## 8. The single most important open question for the product owner

**Do we make the packaged `t-cloud-packaging` chart actually deployable (path A) —
funding the OpenBao init, three-DB Postgres, CA-trust, env reconciliation, and the
`application-production.yml` — so this example validates the *real shipped
product*? Or do we accept a temporary vendored oathy-overlay (path B) that gets a
browser e2e green sooner but validates oathy's internal browsable stack rather than
the published chart?**

The epic's intent ("deploy the published chart as a customer would") points at (A),
but (A) is multi-repo, multi-week work. This scaffold is written for (A) and marks
every (A)-dependency as a blocker; it can be repointed at (B) by swapping the
deploy step for oathy's `values-ci + values-local` overlay.

---

## 9. What this PR actually ships (scaffold inventory)

- `docs/ci-e2e-plan.md` — this document.
- `.github/workflows/example-e2e.yml` — the workflow skeleton, every unresolved
  dependency marked `# BLOCKED(SSO-2912): …`.
- `e2e/` — a Playwright harness draft (mirrors oathy `e2e/scenario` at smaller
  scale): `package.json`, `playwright.config.ts`, `tsconfig.json`,
  `lib/config.ts`, `lib/mailpit.ts` (the proven SSO-2913 Mailpit search-API
  capture), `tests/simple-signin-journey.spec.ts` (the Path-B journey against the
  loopback RP), and `lib/mailpit.parse.test.mjs` (a `node:test` unit for the
  Mailpit link-parse seam — the one piece testable without a cluster).

None of it has been run against a cluster. It is a plan + skeleton + honest
blocker list.
