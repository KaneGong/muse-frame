import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from store import Store
from PIL import Image
from server import App


class ProjectPurgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.photo = Path(self.temp.name, 'assets', 'pose.jpg')
        Image.new('RGB', (400, 600), 'white').save(self.photo)
        self.pid = self.store.put_project('A', {
            'draft': 'draft', 'refs': {},
            'customPoses': [{'id': 'p1', 'name': '侧坐', 'prompt': '侧坐姿态描述', 'category': 'sitting', 'assetId': 'poseasset'}],
        })['id']
        self.store.put_asset({'id': 'poseasset', 'role': 'pose', 'name': 'pose', 'local': 'assets/pose.jpg'}, self.pid)

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_purge_requires_trash_and_keeps_pose_library(self):
        with self.assertRaises(ValueError):
            self.store.purge_project(self.pid)
        self.store.project_action(self.pid, 'trash')
        result = self.store.purge_project(self.pid)
        self.assertEqual(result['archived_poses'], 1)
        with self.assertRaises(ValueError):
            self.store.project(self.pid)
        row = self.store.db.execute("select data from user_presets").fetchone()
        preset = json.loads(row['data'])
        self.assertEqual(preset['field'], 'pose')
        self.assertEqual(preset['name'], '侧坐')
        self.assertTrue(preset['image'].startswith('/library/poses/'))
        image_path = Path(self.temp.name, 'library', preset['image'][len('/library/'):])
        self.assertTrue(image_path.is_file())
        self.assertFalse(Path(self.temp.name, 'assets/pose.jpg').exists())

    def test_purge_keeps_assets_shared_with_another_project(self):
        other = self.store.put_project('B', {'draft': '', 'refs': {}})['id']
        self.store.put_asset({'id': 'poseasset', 'role': 'pose', 'name': 'pose', 'local': 'assets/pose.jpg'}, other)
        self.store.project_action(self.pid, 'trash')
        self.store.purge_project(self.pid)
        self.assertTrue(Path(self.temp.name, 'assets/pose.jpg').is_file())
        self.assertTrue(self.store.asset('poseasset', other))
        self.assertEqual([a['id'] for a in self.store.assets(other)], ['poseasset'])

    def test_editing_a_library_pose_preset_keeps_its_image(self):
        self.store.db.execute('CREATE TABLE IF NOT EXISTS user_presets(id TEXT PRIMARY KEY,data TEXT,updated REAL)')
        app = App.__new__(App)
        app.store = self.store
        created = app.save_preset({'field': 'pose', 'name': '库姿态', 'prompt': '描述', 'image': '/library/poses/a.jpg', 'category': 'sitting'})
        updated = app.save_preset({**created, 'name': '改名后'})
        self.assertEqual(updated['image'], '/library/poses/a.jpg')
        self.assertEqual(updated['category'], 'sitting')


if __name__ == '__main__':
    unittest.main()
