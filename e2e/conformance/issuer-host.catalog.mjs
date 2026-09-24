/**
 * SSO-3296 (epic SSO-3289) — RFC-conformance CATALOG for the PUBLIC ISSUER HOST.
 *
 * Rows are keyed by **RFC + section**, exactly like oathy's `e2e/scenario` catalog: each row carries
 * the spec URL so a failure prints the clause it violates rather than a bare assertion diff. The rows
 * here cover the one thing ADR `2026-09-22-public-issuer-host-auth-subdomain.md` changes — the host
 * the issuer is spelled on — and the two things it explicitly does NOT change (the `/{env}` sandbox
 * path form, and the fact that an issuer is an IDENTITY, not a location).
 *
 * The catalog is **host-word agnostic**: every expectation is derived from the base issuer under test
 * (`THORYN_ISSUER`) and the workspace/environment slugs, never from a literal `hub.` or `auth.`. It is
 * therefore green on both sides of the SSO-3297 cutover, which is what lets it land while staging
 * still serves `hub.stg.thoryn.org`.
 *
 * A row's `run` is a predicate over the resolved context, so a row that is only meaningful AFTER the
 * cutover reports as SKIPPED until `THORYN_TENANT_HOST_LABEL` says `auth` — never as a false green and
 * never as a failure. Run it with `node e2e/conformance/run.mjs`.
 */

/** RFC/spec URLs, so a failure message points at the clause rather than at this file. */
const SPEC = {
  rfc8414: (s) => `https://www.rfc-editor.org/rfc/rfc8414#section-${s}`,
  oidcDiscovery: (s) => `https://openid.net/specs/openid-connect-discovery-1_0.html#${s}`,
  rfc9068: (s) => `https://www.rfc-editor.org/rfc/rfc9068#section-${s}`,
};

/** `https://host/path` → the origin, with any trailing slash removed. */
export function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/**
 * The catalog. Each row:
 *   { rfc, section, title, url, run(ctx) -> boolean, check(ctx) -> Promise<void> }
 * `check` throws on failure; the runner prints `rfc §section — title` plus `url`.
 */
export const catalog = [
  {
    rfc: "RFC 8414",
    section: "2",
    title: "the workspace discovery document's `issuer` is exactly the host it was fetched from",
    url: SPEC.rfc8414("2"),
    run: () => true,
    async check({ workspaceIssuer, fetchJson }) {
      const doc = await fetchJson(`${workspaceIssuer}/.well-known/openid-configuration`);
      if (doc.issuer !== workspaceIssuer) {
        throw new Error(
          `discovery at ${workspaceIssuer} advertises issuer '${doc.issuer}' — RFC 8414 §2 requires the ` +
            `issuer identifier to be the authority the metadata was retrieved from. A mismatch means every ` +
            `RP that validates \`iss\` against its configured issuer will reject the token.`,
        );
      }
    },
  },
  {
    rfc: "RFC 8414",
    section: "3",
    title: "the workspace issuer is a per-workspace host, not a per-workspace path",
    url: SPEC.rfc8414("3"),
    run: ({ workspaceSlug }) => Boolean(workspaceSlug),
    async check({ workspaceIssuer, workspaceSlug }) {
      const { hostname, pathname } = new URL(workspaceIssuer);
      if (!hostname.startsWith(`${workspaceSlug}.`)) {
        throw new Error(
          `workspace issuer host '${hostname}' does not start with the workspace slug '${workspaceSlug}.' — ` +
            `the workspace axis must live in the HOST (one origin per workspace = one cookie jar, ADR §1).`,
        );
      }
      if (pathname !== "" && pathname !== "/") {
        throw new Error(`workspace issuer '${workspaceIssuer}' carries path '${pathname}' — it must be a bare origin.`);
      }
    },
  },
  {
    rfc: "OpenID Connect Discovery 1.0",
    section: "4.3",
    title: "the sandbox issuer keeps the PATH form: workspace issuer + exactly one `/{env}` segment",
    url: SPEC.oidcDiscovery("ProviderConfigurationResponse"),
    run: ({ envSlug }) => Boolean(envSlug),
    async check({ workspaceIssuer, envSlug, fetchJson }) {
      const expected = `${workspaceIssuer}/${envSlug}`;
      const doc = await fetchJson(`${expected}/.well-known/openid-configuration`);
      if (doc.issuer !== expected) {
        throw new Error(
          `sandbox discovery at ${expected} advertises issuer '${doc.issuer}', expected '${expected}'.`,
        );
      }
      // ADR §3 — the host rename must NOT have turned the environment into a subdomain.
      if (originOf(doc.issuer) !== originOf(workspaceIssuer)) {
        throw new Error(
          `sandbox issuer '${doc.issuer}' is on a different ORIGIN from its workspace issuer ` +
            `'${workspaceIssuer}'. ADR §3 keeps environments PATH-based — a subdomain form was considered ` +
            `and rejected (it needs a per-tenant wildcard certificate).`,
        );
      }
      const segments = new URL(doc.issuer).pathname.split("/").filter(Boolean);
      if (segments.length !== 1 || segments[0] !== envSlug) {
        throw new Error(`sandbox issuer path is '${new URL(doc.issuer).pathname}', expected exactly '/${envSlug}'.`);
      }
    },
  },
  {
    rfc: "RFC 9068",
    section: "4",
    title: "the sandbox JWKS is served under the sandbox issuer, so `iss` and the key set agree",
    url: SPEC.rfc9068("4"),
    run: ({ envSlug }) => Boolean(envSlug),
    async check({ workspaceIssuer, envSlug, fetchJson }) {
      const issuer = `${workspaceIssuer}/${envSlug}`;
      const doc = await fetchJson(`${issuer}/.well-known/openid-configuration`);
      if (!doc.jwks_uri || originOf(doc.jwks_uri) !== originOf(issuer)) {
        throw new Error(`sandbox jwks_uri '${doc.jwks_uri}' is not on the sandbox issuer's origin.`);
      }
      const jwks = await fetchJson(doc.jwks_uri);
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error(`sandbox JWKS at ${doc.jwks_uri} is empty — a token minted here could not be validated.`);
      }
    },
  },
  {
    rfc: "RFC 8414",
    section: "2",
    title: "after the cutover the retired `hub.` host is GONE (410), never a redirect to the new issuer",
    url: SPEC.rfc8414("2"),
    // SSO-3297 — only meaningful once the flip has happened. Reported as SKIPPED until then, so this
    // row can land while staging still serves `hub.`.
    run: ({ hostLabel }) => hostLabel === "auth",
    async check({ workspaceIssuer, fetch }) {
      const retired = workspaceIssuer.replace(/:\/\/([^.]+)\.auth\./, "://$1.hub.");
      if (retired === workspaceIssuer) return; // nothing to assert for a non-standard host
      const res = await fetch(`${retired}/.well-known/openid-configuration`, { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        throw new Error(
          `the retired host ${retired} REDIRECTS (${res.status} -> ${res.headers.get("location")}). An issuer ` +
            `is an identity, not a location: forwarding an RP that still trusts the old \`iss\` hands it tokens ` +
            `it cannot validate. The ADR requires 410 Gone so every straggler is visible.`,
        );
      }
      if (res.status !== 410 && res.status !== 404) {
        throw new Error(`the retired host ${retired} answered ${res.status}; expected 410 Gone.`);
      }
    },
  },
];
