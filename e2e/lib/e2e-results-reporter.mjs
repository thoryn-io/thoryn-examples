// SSO-2969 — a Playwright reporter that writes a per-recipe E2E_RESULTS.md from a
// LIVE run, so a reader browsing a recipe can see whether it has E2E coverage, what
// behaviour is tested, and the most recent result — generated from the run, never
// hand-maintained.
//
// It keys off the Playwright PROJECT name, which is the recipe id (see
// playwright.config.ts: projects `simple-signin` and `sandbox-signin`). For each
// project that actually ran, it writes `recipes/<project>/E2E_RESULTS.md`. A project
// that did not run in this invocation (e.g. `--project=sandbox-signin` alone) is left
// untouched — its committed file stays as it was. On `--list` (no results) it writes
// nothing, so discovery/typecheck never clobber the seeded files.
//
// The declared step list + scenario text come from each recipe's `e2e/scenario.mjs`
// (the same source the spec's `test.step(...)` titles use), so the "Steps" table lists
// every intended leg and annotates each with its live pass/fail (matched by title).
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderResultsMarkdown } from "./e2e-results-render.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Pull the non-secret, useful environment a reader wants to see. */
function targetEnv() {
  const issuer = process.env.THORYN_ISSUER || "";
  let issuerHost = "";
  try {
    issuerHost = issuer ? new URL(issuer).host + new URL(issuer).pathname.replace(/\/$/, "") : "";
  } catch {
    issuerHost = issuer;
  }
  return {
    "Issuer": issuerHost,
    "Relying party": process.env.RP_BASE_URL || "",
    "Identity host": process.env.IDENTITY_BASE_URL || "",
    "Mail sink (local API)": process.env.MAILPIT_BASE_URL || "",
  };
}

/** CI run + artifact links, derived from the GitHub Actions environment if present. */
function ciLinks(workflow) {
  const links = [];
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    links.push({
      label: "CI run",
      url: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
    });
  }
  // The Playwright HTML report is uploaded as a workflow artifact (see the workflows).
  links.push({
    label: "Playwright HTML report (CI artifact)",
    url: workflow
      ? `the \`${path.basename(workflow, ".yml")}-playwright-report\` artifact on the CI run`
      : "the Playwright report artifact on the CI run",
  });
  return links;
}

/** Best-effort load of a recipe's declared scenario metadata. */
async function loadScenario(recipeId) {
  const file = path.join(REPO_ROOT, "recipes", recipeId, "e2e", "scenario.mjs");
  try {
    const mod = await import(pathToFileURL(file).href);
    return mod.scenario ?? null;
  } catch {
    return null;
  }
}

/** Overall status from a set of per-test statuses. */
function rollup(statuses) {
  if (statuses.length === 0) return "pending";
  if (statuses.some((s) => s === "failed" || s === "timedOut" || s === "interrupted")) return "failed";
  if (statuses.every((s) => s === "skipped")) return "skipped";
  return "passed";
}

export default class E2eResultsReporter {
  onBegin(config, suite) {
    this._config = config;
    this._suite = suite;
  }

  async onEnd() {
    if (!this._suite) return;
    // Top-level children of the root suite are the project suites.
    const projectSuites = this._suite.suites ?? [];
    for (const projectSuite of projectSuites) {
      const projectName = projectSuite.project?.().name ?? projectSuite.title;
      if (!projectName) continue;
      const tests = projectSuite.allTests?.() ?? [];
      if (tests.length === 0) continue;
      await this._writeForProject(projectName, tests);
    }
  }

  async _writeForProject(recipeId, tests) {
    // Guard: on `playwright test --list` (discovery/typecheck), the tests exist but
    // none RAN, so their `results` arrays are empty. Do NOT overwrite the committed
    // E2E_RESULTS.md placeholder with an all-"skipped" snapshot in that case — only a
    // real run (at least one test with a result) regenerates the file.
    const ran = tests.some((tc) => (tc.results?.length ?? 0) > 0);
    if (!ran) return;

    const scenario = (await loadScenario(recipeId)) ?? { steps: [] };

    // Per-test rollup.
    const testRows = [];
    const liveStepStatusByTitle = new Map();
    const diagnostics = [];
    for (const tc of tests) {
      const result = tc.results?.[tc.results.length - 1];
      const status = result?.status ?? "skipped";
      testRows.push({
        title: tc.title,
        status,
        durationMs: result?.duration,
      });
      // test.step entries carry the journey legs; record their pass/fail by title.
      for (const step of result?.steps ?? []) {
        if (step.category === "test.step") {
          liveStepStatusByTitle.set(step.title, step.error ? "failed" : "passed");
        }
      }
      // Collect a short diagnostic excerpt from any error.
      for (const err of result?.errors ?? []) {
        const msg = (err.message || "").split("\n").slice(0, 6).join("\n").trim();
        if (msg) diagnostics.push(`[${tc.title}] ${msg}`);
      }
    }

    const overall = rollup(testRows.map((t) => t.status));

    // Declared steps, annotated with live status (matched by title; unreached => skipped).
    const declared = scenario.steps ?? [];
    const stepRows = declared.map((s) => ({
      title: s.title,
      status: liveStepStatusByTitle.get(s.title) ?? (overall === "pending" ? "pending" : "skipped"),
    }));
    // Append any live test.step not in the declared list (keeps the report truthful if a
    // spec adds a leg the scenario metadata hasn't caught up with).
    for (const [title, status] of liveStepStatusByTitle) {
      if (!declared.some((d) => d.title === title)) stepRows.push({ title, status });
    }

    const counts = {
      passed: testRows.filter((t) => t.status === "passed").length,
      failed: testRows.filter((t) => ["failed", "timedOut", "interrupted"].includes(t.status)).length,
      skipped: testRows.filter((t) => t.status === "skipped").length,
      total: testRows.length,
    };

    const md = renderResultsMarkdown({
      recipeId,
      scenario,
      workflow: scenario.workflow,
      overall,
      counts,
      steps: stepRows,
      tests: testRows,
      diagnostics: diagnostics.slice(0, 8),
      env: targetEnv(),
      links: ciLinks(scenario.workflow),
      generatedAt: new Date().toISOString(),
      generatedBy: "the Playwright reporter (e2e/lib/e2e-results-reporter.mjs)",
      live: true,
    });

    const outFile = path.join(REPO_ROOT, "recipes", recipeId, "E2E_RESULTS.md");
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, md, "utf8");
    // eslint-disable-next-line no-console
    console.log(`[e2e-results] wrote ${path.relative(REPO_ROOT, outFile)} (${overall})`);
  }
}
