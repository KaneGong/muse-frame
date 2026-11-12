import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_webui_candidate import DESIGN, copy_regular, pinned_download, stage_web_assets


class CandidateBuildTest(unittest.TestCase):
    def test_runtime_staging_keeps_the_maintained_surface(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            stage_web_assets(stage)
            self.assertTrue((stage / DESIGN / "index.html").is_file())
            self.assertTrue((stage / DESIGN / "workspace-migration.html").is_file())
            self.assertTrue((stage / DESIGN / "assets/muse-frame-mark.png").is_file())
            self.assertTrue((stage / "app/standalone-edition").is_file())
            for path in (
                DESIGN / "legacy", DESIGN / "tests", DESIGN / "beta.py",
                "app/static/costume-thumbs", "app/static/costume-full", "data", "tokens",
            ):
                self.assertFalse((stage / path).exists(), path)

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            target = stage / "outside.txt"
            target.write_text("unpackaged", encoding="utf-8")
            link = stage / "link.txt"
            link.symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "regular release file"):
                copy_regular(link, stage / "bundle" / link.name)

    def test_cached_dependency_requires_matching_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            dependency = cache / "runtime.zip"
            data = b"verified runtime"
            dependency.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            self.assertEqual(pinned_download(cache, dependency.name, "unused", digest), dependency)
            dependency.write_bytes(b"corrupt")
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                pinned_download(cache, dependency.name, "unused", digest)


if __name__ == "__main__":
    unittest.main()
