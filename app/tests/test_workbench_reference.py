import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store


class WorkbenchReferenceTest(unittest.TestCase):
    def test_pinned_standard_is_idempotent_and_project_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            app = App.__new__(App)
            app.store = Store(directory)
            try:
                first, second = [app.store.put_project(name, {'refs': {}})['id'] for name in ('One', 'Two')]
                for role in ('face', 'outfit', 'pose'):
                    standard = app.workbench_reference_standard(first, role)
                    self.assertEqual(standard, app.workbench_reference_standard(first, role))
                    asset = app.store.asset(standard['id'], first)
                    self.assertEqual(asset['role'], 'source')
                    self.assertTrue(asset['workbench_format'].startswith(role + ':'))
                    self.assertTrue((Path(directory) / asset['local']).is_file())
                    with self.assertRaises(ValueError):
                        app.store.asset(standard['id'], second)
                    self.assertNotEqual(standard, app.workbench_reference_standard(second, role))
                with self.assertRaises(ValueError):
                    app.workbench_reference_standard(first, 'scene')
                app.store.project_action(second, 'archive')
                with self.assertRaises(ValueError):
                    app.workbench_reference_standard(second, 'pose')
            finally:
                app.store.db.close()
