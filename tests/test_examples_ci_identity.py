"""SSO-3113 (epic SSO-3108) — conformance tests pinning the least-privilege CI identity `examples-ci`.

The thoryn-examples sibling of thoryn-cli's `CiProvisionFileConformanceTest` + `CiConnectionConfinementTest`.
They bind `.thoryn/provision.yaml` (the workspace-level "what I own" file) to the recipes CI runs, so neither
can silently widen the identity's reach:

  * the identity's scopes are EXACTLY what converging CI's files needs — recomputed from the kinds those
    files declare and the CLI actions the recipes' journeys run;
  * the identity's whole declared reach is `manager` on one fixture sandbox per recipe — all 9 (settled
    2026-09-17, SSO-3131) — nothing on the production plane, nothing workspace-wide, no other subject on
    those sandboxes;
  * every recipe runs in its sandbox, except one whose sandbox rework is BLOCKED on a recorded product gap
    (PENDING_SANDBOX_REWORK) — and such an entry must be removed the moment the recipe moves;
  * `connection.json` signs in as `examples-ci`, names the confined secret, and requests exactly the scopes
    the file declares for it (SSO-3113 step 2);
  * every workflow that signs in injects the confined secret and ONLY that secret (never the legacy one
    beside it), and every scenario workflow adopts its recipe's fixture sandbox `ci-<recipe>` — no per-run
    slug, no `env create`, no `env delete` (a confined identity cannot create an environment).

Run: python3 -m unittest discover -s tests -v   (needs PyYAML; CI installs nothing else)
"""

import json
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
PROVISION = ROOT / ".thoryn" / "provision.yaml"
CONNECTION = ROOT / ".thoryn" / "connection.json"
RECIPES = ROOT / "recipes"

CI_CLIENT_ID = "examples-ci"
CI_SUBJECT = f"client:{CI_CLIENT_ID}"
CONFINED_SECRET_ENV = "THORYN_EXAMPLES_CONFINED_CI_CLIENT_SECRET"
LEGACY_SECRET_ENV = "THORYN_EXAMPLES_CI_CLIENT_SECRET"  # app-9450eb88-c1f's — retired, must not resurface
WORKFLOWS = ROOT / ".github" / "workflows"

# Recipes whose move INTO their fixture sandbox is blocked on a recorded product gap. Every recipe gets a
# fixture (SSO-3131 settled: one confined identity covers all 9); an entry here only tolerates the recipe
# still running on the production plane until its gap closes. Never add an entry without a gap ticket.
# Empty since SSO-3131: simple-signin, the last one, moved into `ci-simple-signin` once SSO-3135 made the sandbox
# capture the account-unlock email to the test-inbox.
PENDING_SANDBOX_REWORK = {}

# The product-api scope AREA a provisioning kind is managed through (`tenant:<area>.<read|write>`) —
# the same mapping thoryn-cli's conformance test uses.
KIND_AREA = {
    "environment": "environments",
    "application": "applications",
    "user": "users",
    "federationMember": "federation",
    "emailProvider": "email",
    "loginTheme": "idp",
    "loginFlow": "idp",
    "loginMethods": "idp",
}

# CLI actions a journey (spec or the shared e2e/lib helpers it imports) runs as the CI session, and the
# scope area each needs (thoryn-cli: LoginFlowCommand / LoginMethodsCommand → idp; `env test-emails` →
# environments.read).
CLI_ACTION_AREA = {
    '"login-flow"': "idp",
    '"login-methods"': "idp",
    '"test-emails"': "environments",
    '"users"': "users",
}

SECRET_KEY = re.compile(r"([Pp]assword|[Ss]ecret|[Tt]oken)$")


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def key(resource):
    return f"{resource['kind']}/{resource.get('name', '')}"


def recipe_ids():
    return sorted(p.parent.name for p in RECIPES.glob("*/provision.yaml"))


def recipe_provision(recipe_id):
    return load_yaml(RECIPES / recipe_id / "provision.yaml")


def sandbox_recipes():
    """Recipes whose provision file declares a sandbox environment (the ones a fixture can host)."""
    return sorted(
        r for r in recipe_ids() if any(x["kind"] == "environment" for x in recipe_provision(r)["resources"])
    )


def scopes_for_areas(areas):
    return {f"tenant:{a}.{op}" for a in areas for op in ("read", "write")}


def journey_sources(recipe_id):
    """A recipe's journey sources plus the shared e2e/lib modules they import (one hop is all there is)."""
    files = [p for p in (RECIPES / recipe_id / "e2e").rglob("*") if p.suffix in (".ts", ".mjs") and p.is_file()]
    libs = set()
    for f in files:
        for m in re.finditer(r"""from\s+["'][./]*e2e/lib/([\w.-]+)["']""", f.read_text(encoding="utf-8")):
            name = m.group(1)
            for candidate in (name, name.removesuffix(".js") + ".mjs", name.removesuffix(".js") + ".ts"):
                p = ROOT / "e2e" / "lib" / candidate
                if p.is_file():
                    libs.add(p)
                    break
    return files + sorted(libs)


class ExamplesCiIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.file = load_yaml(PROVISION)
        cls.resources = cls.file["resources"]
        cls.connection = json.loads(CONNECTION.read_text(encoding="utf-8"))
        cls.recipes = recipe_ids()

    def ci(self):
        return next(r for r in self.resources if key(r) == f"application/{CI_CLIENT_ID}")

    def test_every_recipe_runs_in_a_sandbox_unless_its_rework_is_blocked_on_a_recorded_gap(self):
        unknown = set(PENDING_SANDBOX_REWORK) - set(self.recipes)
        self.assertFalse(unknown, f"PENDING_SANDBOX_REWORK names recipes that do not exist: {unknown}")
        for recipe, reason in PENDING_SANDBOX_REWORK.items():
            self.assertRegex(reason, r"^SSO-\d+ ", f"{recipe}: a pending rework must name its gap ticket")
        # Exactly the pending recipes are still production-plane: a new recipe cannot start there, and a
        # reworked recipe must drop its entry.
        self.assertEqual(set(self.recipes) - set(sandbox_recipes()), set(PENDING_SANDBOX_REWORK))

    def test_only_a_pending_recipe_still_uses_the_workspace_email_provider(self):
        # The workspace BYO-SMTP is production-plane reach examples-ci must never need.
        for wf in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
            text = wf.read_text(encoding="utf-8")
            if "email-provider" not in text:
                continue
            m = re.search(r"^\s*RECIPE:\s*([\w-]+)", text, re.MULTILINE)
            self.assertTrue(m and m.group(1) in PENDING_SANDBOX_REWORK, f"{wf.name} drives the workspace email provider")

    def test_the_file_declares_the_ci_identity_plus_exactly_one_fixture_sandbox_per_recipe(self):
        self.assertEqual(self.file["apiVersion"], "thoryn.io/provision/v1")
        expected = [f"application/{CI_CLIENT_ID}"] + [f"environment/{r}" for r in self.recipes]
        self.assertEqual([key(r) for r in self.resources], expected)
        # The production plane holds exactly one resource: the identity itself.
        production = [key(r) for r in self.resources if r["kind"] != "environment" and "environment" not in r]
        self.assertEqual(production, [f"application/{CI_CLIENT_ID}"])

    def test_each_fixture_sandbox_has_a_fixed_slug_and_the_display_name_its_recipe_declares(self):
        for recipe in self.recipes:
            env = next(r for r in self.resources if key(r) == f"environment/{recipe}")
            self.assertEqual(env["spec"]["slug"], f"ci-{recipe}")
            self.assertNotIn("{{", env["spec"]["slug"], "a fixture slug is fixed, never a per-run placeholder")
            recipe_env = next((x for x in recipe_provision(recipe)["resources"] if x["kind"] == "environment"), None)
            # Adopting the fixture through the recipe must converge as a no-op, not rename it every run. A
            # pending recipe has no environment yet; its fixture uses the name the rework will declare.
            want = recipe_env["spec"].get("displayName") if recipe_env else f"{recipe} example"
            self.assertEqual(env["spec"].get("displayName"), want, recipe)

    def test_the_ci_identity_is_a_confidential_client_credentials_client_on_the_production_plane(self):
        ci = self.ci()
        self.assertNotIn("environment", ci)
        self.assertEqual(ci["spec"]["clientId"], CI_CLIENT_ID)
        self.assertEqual(ci["spec"]["clientType"], "confidential")
        self.assertEqual(ci["spec"]["grantTypes"], ["client_credentials"])
        self.assertNotIn("redirectUris", ci["spec"])
        self.assertNotIn("postLogoutRedirectUris", ci["spec"])

    def test_the_ci_identity_holds_exactly_the_scopes_converging_its_files_needs(self):
        areas = set()
        converged = [self.file] + [recipe_provision(r) for r in self.recipes]
        for doc in converged:
            areas |= {KIND_AREA[r["kind"]] for r in doc["resources"]}
        for recipe in self.recipes:
            for src in journey_sources(recipe):
                text = src.read_text(encoding="utf-8")
                areas |= {area for action, area in CLI_ACTION_AREA.items() if action in text}
        expected = scopes_for_areas(areas)
        if any("grants" in r for doc in converged for r in doc["resources"]):
            expected |= {"tenant:access.read", "tenant:access.write"}
        granted = set(self.ci()["spec"]["scopes"])
        self.assertEqual(granted, expected, f"{CI_CLIENT_ID} holds {sorted(granted)}; needs exactly {sorted(expected)}")
        self.assertEqual(len(self.ci()["spec"]["scopes"]), len(granted), "duplicate scope")

    def test_every_recipe_declares_requirements_the_identity_holds(self):
        granted = set(self.ci()["spec"]["scopes"])
        for recipe in self.recipes:
            required = set(load_yaml(RECIPES / recipe / "recipe.yaml").get("requires", {}).get("scopes", []))
            self.assertLessEqual(required, granted, f"{recipe} requires {sorted(required - granted)} which {CI_CLIENT_ID} lacks")

    def test_the_ci_identitys_whole_declared_reach_is_manager_on_its_fixture_sandboxes(self):
        reach = sorted(
            f"{key(r)} {g['relation']}" for r in self.resources for g in r.get("grants") or [] if g["subject"] == CI_SUBJECT
        )
        self.assertEqual(reach, sorted(f"environment/{r} manager" for r in self.recipes))
        # No grant on the identity's own record (creator-becomes-manager covers it) and nothing on the
        # production plane; each sandbox grants nobody but the CI identity.
        self.assertNotIn("grants", self.ci())
        for r in self.resources:
            if r["kind"] == "environment":
                self.assertEqual(r["grants"], [{"subject": CI_SUBJECT, "relation": "manager"}], key(r))

    def test_the_recipe_provision_files_grant_nothing(self):
        # A recipe is a customer-facing example; it must never smuggle reach for the CI identity.
        for recipe in recipe_ids():
            for r in recipe_provision(recipe)["resources"]:
                self.assertNotIn("grants", r, f"{recipe}: {key(r)}")

    def test_the_provisioning_file_carries_no_secret_and_needs_no_env_var(self):
        for r in self.resources:
            spec = r["spec"]
            self.assertFalse([k for k in spec if SECRET_KEY.search(k)], key(r))
            self.assertFalse([k for k in spec if k.endswith("Env")], key(r))
            self.assertNotIn("{{", json.dumps(spec), key(r))

    def test_the_connection_signs_in_as_the_ci_identity_with_exactly_its_declared_scopes(self):
        # SSO-3113 step 2: connection.json is bound to this file. A regression to the legacy client, a wider
        # scope request, or the old secret name would silently re-open the reach the epic removed.
        auth = self.connection["auth"]
        self.assertEqual(self.connection["workspace"]["slug"], "examples")
        self.assertEqual(auth["method"], "client_credentials")
        self.assertEqual(auth["clientId"], CI_CLIENT_ID)
        self.assertEqual(auth["secretEnv"], CONFINED_SECRET_ENV)
        self.assertEqual(set(auth["scopes"]), set(self.ci()["spec"]["scopes"]))
        self.assertEqual(len(auth["scopes"]), len(set(auth["scopes"])), "duplicate scope")

    def test_every_workflow_that_signs_in_injects_the_confined_secret_and_only_that_secret(self):
        signing_in = []
        for wf in sorted(WORKFLOWS.glob("*.yml")):
            text = wf.read_text(encoding="utf-8")
            self.assertNotIn(LEGACY_SECRET_ENV, text, f"{wf.name} still names the retired legacy secret")
            if "login --connection" not in text:
                continue
            signing_in.append(wf.name)
            self.assertIn(f"secrets.{CONFINED_SECRET_ENV}", text, f"{wf.name} signs in but does not inject {CONFINED_SECRET_ENV}")
            self.assertIn(f'[ -n "${{{CONFINED_SECRET_ENV}:-}}" ]', text, f"{wf.name} must fail loud when the secret is unset")
            injected = set(re.findall(r"secrets\.(THORYN_[A-Z_]*SECRET)", text))
            self.assertEqual(injected, {CONFINED_SECRET_ENV}, f"{wf.name} injects {sorted(injected)}")
        self.assertTrue(signing_in, "no workflow signs in from the connection contract")

    def test_every_scenario_workflow_adopts_its_recipes_fixture_sandbox(self):
        # One long-lived fixture per recipe (`ci-<recipe>`), adopted by slug: never a per-run slug (a confined
        # identity cannot create an environment), never an env create/delete around the recipe.
        seen = set()
        for wf in sorted(WORKFLOWS.glob("*.yml")):
            text = wf.read_text(encoding="utf-8")
            m = re.search(r"^\s*RECIPE:\s*([\w-]+)", text, re.MULTILINE)
            if not m:
                continue
            recipe = m.group(1)
            seen.add(recipe)
            self.assertNotRegex(text, r"\benv (create|delete)\b", f"{wf.name} creates or deletes an environment")
            if recipe in PENDING_SANDBOX_REWORK:
                continue  # still production-plane by recorded gap; no sandbox to adopt yet
            self.assertIn(f'E2E_ENV_SLUG=ci-${{RECIPE}}', text, f"{wf.name} must bind to the fixture ci-{recipe}")
            self.assertNotIn("GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}", text, f"{wf.name} still names a per-run sandbox")
        self.assertEqual(seen, set(self.recipes), "every recipe has exactly one scenario workflow")
        conformance = (WORKFLOWS / "conformance.yml").read_text(encoding="utf-8")
        self.assertIn('--set "envSlug=ci-$id"', conformance)
        self.assertNotIn("conf-", conformance.split("jobs:")[1].replace("conf-<id>-<run>", ""), "conformance still mints per-run sandboxes")
        self.assertIn("Assert the CI identity is confined", conformance)


if __name__ == "__main__":
    unittest.main()
