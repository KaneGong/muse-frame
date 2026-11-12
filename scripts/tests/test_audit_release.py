import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "audit_release.py"
SPEC = importlib.util.spec_from_file_location("audit_release", SCRIPT)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class AuditReleaseTest(unittest.TestCase):
    def test_archive_audit_only_exempts_reviewed_catalogs_and_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in (
                "LICENSE", "COPYRIGHT", "README.md", "README.zh-CN.md",
                "THIRD_PARTY_NOTICES.md", "ASSET_LICENSES.md", "package-lock.json",
                "VERSION", "package.json", "licenses/manifest.json",
            ):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text({
                    "LICENSE": "GNU AFFERO GENERAL PUBLIC LICENSE",
                    "VERSION": "0.5.0-beta.5",
                    "package.json": '{"version":"0.5.0-beta.5","license":"AGPL-3.0-only"}',
                    "licenses/manifest.json": "[]",
                }.get(name, ""), encoding="utf-8")
            for relative in AUDIT.PUBLIC_CATALOGS:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")
            target = root / AUDIT.LEGACY_TARGET
            target.mkdir()
            (target / "index.html").write_text("", encoding="utf-8")
            link = root / AUDIT.LEGACY_LINK
            link.symlink_to("../muse-frame-next", target_is_directory=True)

            with (patch.object(AUDIT, "ROOT", root),
                  patch.object(AUDIT.subprocess, "run", side_effect=FileNotFoundError),
                  contextlib.redirect_stdout(io.StringIO())):
                self.assertEqual(AUDIT.audit()["problems"], [])

                catalog = root / "design/muse-frame-04/data/costumes.json"
                catalog.write_text('/' + 'home/' + 'example/private', encoding="utf-8")
                unexpected = catalog.parent / "unexpected.json"
                unexpected.write_text("{}", encoding="utf-8")
                other_link = link.with_name("other-link")
                other_link.symlink_to("../muse-frame-next", target_is_directory=True)
                link.unlink()
                link.symlink_to(target, target_is_directory=True)

                problems = {item["path"]: item["reason"] for item in AUDIT.audit()["problems"]}
                self.assertEqual(problems, {
                    str(catalog.relative_to(root)): "private path or credential-like text",
                    str(unexpected.relative_to(root)): "private/build directory in source",
                    str(other_link.relative_to(root)): "source symlink needs explicit review",
                    str(AUDIT.LEGACY_LINK): "source symlink needs explicit review",
                })
