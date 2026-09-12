// SSO-2969 — seed (or re-seed) the per-recipe E2E_RESULTS.md placeholder from each
// recipe's declared scenario metadata. Run with `npm run results:init` (from e2e/).
//
// This writes the HONEST "not yet run in this environment" file for every recipe that
// has an `e2e/scenario.mjs`, so a reader browsing a recipe immediately sees: it HAS
// E2E coverage, WHAT behaviour is tested (the declared steps), and that the latest
// result is pending a live CI run. A real run (the Playwright reporter) overwrites the
// file with actual pass/fail + diagnostics + a CI link — same document shape, live
// fields filled in.
//
// It never overwrites a file that already carries a LIVE result unless you pass
// `--force`, so re-running it locally won't stomp a genuine CI-produced report that
// happens to be checked out.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderResultsMarkdown } from "../lib/e2e-results-render.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RECIPES_DIR = path.join(REPO_ROOT, "recipes");
const FORCE = process.argv.includes("--force");

async function listRecipeIds() {
  const entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
  const ids = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const scenario = path.join(RECIPES_DIR, e.name, "e2e", "scenario.mjs");
    try {
      await fs.access(scenario);
      ids.push(e.name);
    } catch {
      // No colocated e2e scenario — skip (recipe has no E2E coverage yet).
    }
  }
  return ids.sort();
}

async function loadScenario(recipeId) {
  const file = path.join(RECIPES_DIR, recipeId, "e2e", "scenario.mjs");
  const mod = await import(pathToFileURL(file).href);
  return mod.scenario;
}

async function main() {
  const ids = await listRecipeIds();
  if (ids.length === 0) {
    console.log("[results:init] no recipes with e2e/scenario.mjs found");
    return;
  }
  for (const recipeId of ids) {
    const outFile = path.join(RECIPES_DIR, recipeId, "E2E_RESULTS.md");
    if (!FORCE) {
      try {
        const existing = await fs.readFile(outFile, "utf8");
        // A live report is produced by the reporter; the placeholder is produced here.
        if (existing.includes("by the Playwright reporter")) {
          console.log(`[results:init] skip ${recipeId} — already has a live report (use --force to reseed)`);
          continue;
        }
      } catch {
        // No file yet — create it.
      }
    }
    const scenario = await loadScenario(recipeId);
    const steps = (scenario.steps ?? []).map((s) => ({ title: s.title, status: "pending" }));
    const md = renderResultsMarkdown({
      recipeId,
      scenario,
      workflow: scenario.workflow,
      overall: "pending",
      counts: {},
      steps,
      tests: [],
      diagnostics: [],
      env: {},
      links: [],
      generatedAt: new Date().toISOString(),
      generatedBy: "the init generator (e2e/scripts/init-e2e-results.mjs)",
      live: false,
    });
    await fs.writeFile(outFile, md, "utf8");
    console.log(`[results:init] wrote ${path.relative(REPO_ROOT, outFile)} (pending)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
