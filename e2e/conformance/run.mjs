#!/usr/bin/env node
/**
 * SSO-3296 — runner for the issuer-host RFC-conformance catalog (`issuer-host.catalog.mjs`).
 *
 * Entirely env-driven, so the same script runs in `conformance.yml` against staging and by hand
 * against any platform:
 *
 *   THORYN_ISSUER              base issuer, e.g. https://hub.stg.thoryn.org (required)
 *   THORYN_WORKSPACE_SLUG      the workspace to resolve, e.g. `examples`    (required)
 *   THORYN_TENANT_HOST_LABEL   `hub` (today) or `auth` (after SSO-3297); default `hub`
 *   THORYN_CONFORMANCE_ENV     a sandbox slug to assert the `/{env}` form against (optional)
 *
 * Exit 0 when every ROW THAT RAN passed. A row whose `run` predicate is false prints SKIP and is not
 * a failure — that is how the post-cutover row lands before the cutover.
 */

import { catalog } from "./issuer-host.catalog.mjs";

const baseIssuer = (process.env.THORYN_ISSUER ?? "").trim().replace(/\/+$/, "");
const workspaceSlug = (process.env.THORYN_WORKSPACE_SLUG ?? "").trim();
const hostLabel = (process.env.THORYN_TENANT_HOST_LABEL ?? "hub").trim().toLowerCase();
const envSlug = (process.env.THORYN_CONFORMANCE_ENV ?? "").trim();

if (!baseIssuer || !workspaceSlug) {
  console.error("THORYN_ISSUER and THORYN_WORKSPACE_SLUG are required.");
  process.exit(2);
}

/**
 * The workspace issuer, composed the way the platform composes it: the slug prefixed onto the BASE
 * issuer's host, reusing whatever label that host already carries. No literal `hub.`/`auth.` here —
 * this mirrors the CLI's `ThorynConfig.tenantIssuer` (thoryn-cli, SSO-3296).
 */
const base = new URL(baseIssuer);
const workspaceIssuer = `${base.protocol}//${workspaceSlug}.${base.host}`;

const timeoutMs = Number(process.env.THORYN_CONFORMANCE_TIMEOUT_MS ?? 15_000);

async function fetchWithTimeout(url, init = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

const ctx = { baseIssuer, workspaceIssuer, workspaceSlug, envSlug, hostLabel, fetchJson, fetch: fetchWithTimeout };

console.log(`issuer-host conformance — base ${baseIssuer}, workspace ${workspaceIssuer}, label '${hostLabel}'`);
console.log(envSlug ? `sandbox rows run against environment '${envSlug}'` : "no THORYN_CONFORMANCE_ENV — sandbox rows skipped");
console.log("");

let failed = 0;
let ran = 0;
let skipped = 0;

for (const row of catalog) {
  const id = `${row.rfc} §${row.section} — ${row.title}`;
  if (!row.run(ctx)) {
    skipped += 1;
    console.log(`SKIP  ${id}`);
    continue;
  }
  ran += 1;
  try {
    await row.check(ctx);
    console.log(`PASS  ${id}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${id}`);
    console.log(`      ${row.url}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("");
console.log(`${ran} ran, ${failed} failed, ${skipped} skipped`);
process.exit(failed === 0 ? 0 : 1);
