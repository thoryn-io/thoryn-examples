import { defineConfig, devices } from "@playwright/test";

/**
 * SSO-2909 — Playwright config for the simple-signin example e2e. Runs against the
 * LIVE browsable stack deployed by .github/workflows/example-e2e.yml (or a local
 * k3d bring-up), NOT a Testcontainers boot.
 *
 * `ignoreHTTPSErrors: true` because the browsable stack serves HTTPS with
 * ingress-nginx's self-signed cert. Single Chromium project (a real browser OAuth
 * journey). No globalSetup: each run does a fresh self-service sign-up, so there is
 * no seeded session to establish.
 *
 * SCAFFOLD — never run against a cluster. See docs/ci-e2e-plan.md.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/example-e2e-junit.xml" }],
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
      name: "example (Chromium)",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
