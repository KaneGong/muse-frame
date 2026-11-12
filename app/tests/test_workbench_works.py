import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from store import Store


class WorkbenchWorksTest(unittest.TestCase):
    def test_contact_sheet_respects_project_status_and_asset_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            try:
                current, other, archived = [
                    store.put_project(name, {'refs': {}})['id']
                    for name in ('Current', 'Other', 'Archived')
                ]
                for pid in (current, archived):
                    store.put_asset({'name': 'Excluded project', 'role': 'output'}, pid)
                for n in range(10):
                    store.put_asset({'id': f'photo-{n}', 'name': f'Photo {n}', 'role': 'output', 'created_at': n + 1}, other)
                store.put_asset({'id': 'reference', 'name': 'Reference', 'role': 'pose'}, other)
                store.asset_action(other, ['photo-9'], {'trashed': True})
                store.asset_action(other, ['photo-8'], {'adopted': True})
                store.project_action(archived, 'archive')

                group, = store.workbench_works(current)
                self.assertEqual(group['id'], other)
                self.assertEqual(group['total'], 9)
                self.assertEqual([a['id'] for a in group['works']], [f'photo-{n}' for n in range(8, 0, -1)])
                self.assertTrue(group['works'][0]['adopted'])
                self.assertNotIn('project_meta', group['works'][0])
                with self.assertRaises(ValueError):
                    store.workbench_works('unknown')
            finally:
                store.db.close()
