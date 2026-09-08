import { defineConfig, devices } from "@playwright/test";

/**
 * SSO-2909 — Playwright config for the simple-signin example e2e. Runs against the
 * STAGING SaaS via the recipe's real loopback RP, started by
 * .github/workflows/example-e2e.yml (or by hand locally). NOT a Testcontainers boot,
 * NOT a k3d cluster.
 *
 * `ignoreHTTPSErrors: true` is a harmless belt-and-braces (staging serves a real
 * cert; a self-hosted trial would not). Single Chromium project (a real browser OAuth
 * journey). No globalSetup: each run does a fresh self-service sign-up, so there is
 * no seeded session to establish.
 *
 * SCAFFOLD — activates once the CI secrets exist and a first live run passes.
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
