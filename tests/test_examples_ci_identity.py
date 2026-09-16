"""SSO-3113 (epic SSO-3108) — conformance tests pinning the least-privilege CI identity `examples-ci`.

The thoryn-examples sibling of thoryn-cli's `CiProvisionFileConformanceTest` + `CiConnectionConfinementTest`.
They bind `.thoryn/provision.yaml` (the workspace-level "what I own" file) to the recipes CI runs, so neither
can silently widen the identity's reach:

  * the identity's scopes are EXACTLY what converging CI's files needs — recomputed from the kinds those
    files declare and the CLI actions the confined recipes' journeys run;
  * the identity's whole declared reach is `manager` on one fixture sandbox per sandbox-plane recipe —
    nothing on the production plane, nothing workspace-wide, no other subject on those sandboxes;
  * every recipe is either confined (it has a fixture) or explicitly listed as NOT confined with a reason,
    so a new recipe forces the decision instead of inheriting reach by accident;
  * `connection.json`'s scopes stay within what the file declares for the client it signs in with.

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

# Recipes deliberately NOT on the confined identity — each needs reach a sandbox manager cannot have.
NOT_CONFINED = {
    "simple-signin": "production plane: a production-plane client + user and the workspace BYO-SMTP "
    "email provider need manager on the WORKSPACE (ADR 2026-09-15 §4 create rule)",
}

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
        cls.confined = sorted(r for r in recipe_ids() if r not in NOT_CONFINED)

    def ci(self):
        return next(r for r in self.resources if key(r) == f"application/{CI_CLIENT_ID}")

    def test_every_recipe_is_either_confined_or_explicitly_not_confined(self):
        unknown = set(NOT_CONFINED) - set(recipe_ids())
        self.assertFalse(unknown, f"NOT_CONFINED names recipes that do not exist: {unknown}")
        # Confined == sandbox-plane recipes: a production-plane recipe cannot be confined to a sandbox, and a
        # sandbox-plane recipe has no reason to stay off the confined identity.
        self.assertEqual(self.confined, sandbox_recipes())

    def test_the_file_declares_the_ci_identity_plus_exactly_one_fixture_sandbox_per_confined_recipe(self):
        self.assertEqual(self.file["apiVersion"], "thoryn.io/provision/v1")
        expected = [f"application/{CI_CLIENT_ID}"] + [f"environment/{r}" for r in self.confined]
        self.assertEqual([key(r) for r in self.resources], expected)
        # The production plane holds exactly one resource: the identity itself.
        production = [key(r) for r in self.resources if r["kind"] != "environment" and "environment" not in r]
        self.assertEqual(production, [f"application/{CI_CLIENT_ID}"])

    def test_each_fixture_sandbox_has_a_fixed_slug_and_the_display_name_its_recipe_declares(self):
        for recipe in self.confined:
            env = next(r for r in self.resources if key(r) == f"environment/{recipe}")
            self.assertEqual(env["spec"]["slug"], f"ci-{recipe}")
            self.assertNotIn("{{", env["spec"]["slug"], "a fixture slug is fixed, never a per-run placeholder")
            recipe_env = next(x for x in recipe_provision(recipe)["resources"] if x["kind"] == "environment")
            # Adopting the fixture through the recipe must converge as a no-op, not rename it every run.
            self.assertEqual(env["spec"].get("displayName"), recipe_env["spec"].get("displayName"), recipe)

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
        converged = [self.file] + [recipe_provision(r) for r in self.confined]
        for doc in converged:
            areas |= {KIND_AREA[r["kind"]] for r in doc["resources"]}
        for recipe in self.confined:
            for src in journey_sources(recipe):
                text = src.read_text(encoding="utf-8")
                areas |= {area for action, area in CLI_ACTION_AREA.items() if action in text}
        expected = scopes_for_areas(areas)
        if any("grants" in r for doc in converged for r in doc["resources"]):
            expected |= {"tenant:access.read", "tenant:access.write"}
        granted = set(self.ci()["spec"]["scopes"])
        self.assertEqual(granted, expected, f"{CI_CLIENT_ID} holds {sorted(granted)}; needs exactly {sorted(expected)}")
        self.assertEqual(len(self.ci()["spec"]["scopes"]), len(granted), "duplicate scope")

    def test_every_confined_recipe_declares_requirements_the_identity_holds(self):
        granted = set(self.ci()["spec"]["scopes"])
        for recipe in self.confined:
            required = set(load_yaml(RECIPES / recipe / "recipe.yaml").get("requires", {}).get("scopes", []))
            self.assertLessEqual(required, granted, f"{recipe} requires {sorted(required - granted)} which {CI_CLIENT_ID} lacks")

    def test_the_ci_identitys_whole_declared_reach_is_manager_on_its_fixture_sandboxes(self):
        reach = sorted(
            f"{key(r)} {g['relation']}" for r in self.resources for g in r.get("grants") or [] if g["subject"] == CI_SUBJECT
        )
        self.assertEqual(reach, sorted(f"environment/{r} manager" for r in self.confined))
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

    def test_the_connection_scopes_are_within_the_grant_of_the_client_it_signs_in_with(self):
        client_id = self.connection["auth"]["clientId"]
        if client_id != CI_CLIENT_ID:
            # Step 1 of SSO-3113: examples-ci is declared but its secret does not exist until a founder
            # applies this file, so connection.json still names the legacy client. Step 2 flips it — from
            # then on this test binds the two files.
            self.skipTest(f"connection.json still signs in as legacy '{client_id}' (SSO-3113 step 2 switches it)")
        declared = next(
            (r for r in self.resources if r["kind"] == "application" and r["spec"].get("clientId") == client_id), None
        )
        self.assertIsNotNone(declared, f"connection.json signs in as '{client_id}', which this repo does not declare")
        requested = set(self.connection["auth"]["scopes"])
        self.assertLessEqual(requested, set(declared["spec"]["scopes"]))


if __name__ == "__main__":
    unittest.main()
