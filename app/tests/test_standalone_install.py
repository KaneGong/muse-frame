import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('standalone_builder', Path(__file__).resolve().parents[2] / 'scripts/build_standalone_app.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SafeInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.source = root / 'new.app'
        self.target = root / 'installed.app'
        self.source.mkdir(); (self.source / 'version').write_text('new')
        self.target.mkdir(); (self.target / 'version').write_text('old')

    def fake_run(self, args, **kwargs):
        if args[0] == 'ditto':
            shutil.copytree(args[1], args[2])

    def test_success_preserves_previous_bundle(self):
        with patch.object(builder.subprocess, 'run', side_effect=self.fake_run):
            result = builder.install(self.source, self.target)
        self.assertEqual((self.target / 'version').read_text(), 'new')
        self.assertEqual((Path(result['previous_app_backup']) / 'version').read_text(), 'old')

    def test_failed_signature_check_leaves_previous_bundle_untouched(self):
        def run(args, **kwargs):
            self.fake_run(args, **kwargs)
            if args[0] == 'codesign':
                raise subprocess.CalledProcessError(1, args)
        with patch.object(builder.subprocess, 'run', side_effect=run):
            with self.assertRaises(subprocess.CalledProcessError):
                builder.install(self.source, self.target)
        self.assertEqual((self.target / 'version').read_text(), 'old')


if __name__ == '__main__':
    unittest.main()
