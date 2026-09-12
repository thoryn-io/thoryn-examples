// `@thoryn/example-e2e` is an ESM package (`"type": "module"`), and `@playwright/test`
// is published as CommonJS; on modern Node its named ESM exports aren't reliably seen
// when Playwright loads this config via the native ESM loader. Import the default
// (CJS) export — which IS the full module.exports object — and read the helpers off it.
// The cast restores the precise module types (the runtime value genuinely is that shape),
// so this both loads cleanly on Node 20/22/24 and type-checks.
import pkgDefault from "@playwright/test";
const { defineConfig, devices } = pkgDefault as unknown as typeof import("@playwright/test");

/**
 * Shared Playwright config for the example E2E suites. Each RECIPE owns its spec,
 * colocated under `recipes/<id>/e2e/`; this one config wires them in as PROJECTS whose
 * name is the recipe id. The shared harness (lib/config.ts, lib/mailbox.ts, the results
 * reporter) lives here in `e2e/` and is imported by every recipe's spec — one reusable
 * home, no duplicated setup.
 *
 * Runs against the STAGING SaaS via each recipe's real loopback RP, started by the
 * workflow (.github/workflows/example-e2e.yml for simple-signin, sandbox-e2e.yml for
 * sandbox-signin) or by hand locally. NOT a Testcontainers boot, NOT a k3d cluster.
 *
 * Because the harness is env-driven (THORYN_ISSUER / THORYN_CLIENT_ID / RP_BASE_URL /
 * IDENTITY_BASE_URL / MAILPIT_BASE_URL — see lib/config.ts), a live run targets ONE
 * recipe at a time with that recipe's env:
 *
 *     npx playwright test --project=simple-signin     # example-e2e.yml
 *     npx playwright test --project=sandbox-signin     # sandbox-e2e.yml
 *
 * The custom `lib/e2e-results-reporter.mjs` reporter writes recipes/<project>/E2E_RESULTS.md
 * for each project that actually ran, so the per-recipe result file is generated from the
 * run, never hand-maintained.
 *
 * `ignoreHTTPSErrors: true` is a harmless belt-and-braces (staging serves a real cert).
 * No globalSetup: each run does a fresh self-service sign-up, so there is no seeded
 * session to establish.
 *
 * SCAFFOLD — activates once the CI secrets exist and a first live run passes.
 */
export default defineConfig({
  // testDir is set per-project (each recipe's colocated e2e/ folder).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/example-e2e-junit.xml" }],
    // Writes recipes/<project>/E2E_RESULTS.md from the live run (per-recipe coverage report).
    ["./lib/e2e-results-reporter.mjs"],
  ],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "simple-signin",
      testDir: "../recipes/simple-signin/e2e",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "sandbox-signin",
      testDir: "../recipes/sandbox-signin/e2e",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "branded-signin",
      testDir: "../recipes/branded-signin/e2e",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
