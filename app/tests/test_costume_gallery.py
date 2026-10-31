"""内置服装库：目录自洽、按需下载、去重导入。"""
import io, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('PORTRAIT_STUDIO_DATA', tempfile.mkdtemp())
import server

PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 40000


class _Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


class _Store:
    def __init__(self, root):
        self.root = Path(root)
        self.items = []

    def assets(self, pid): return list(self.items)

    def asset(self, aid, pid=None):
        return dict(next(a for a in self.items if a['id'] == aid))

    def put_asset(self, a, pid=None):
        for i, old in enumerate(self.items):
            if old['id'] == a['id']:
                self.items[i] = dict(a)
                break
        return dict(a)


class _App:
    def __init__(self, root):
        self.store = _Store(root)
        self.uploads = 0

    def costume_gallery(self):
        return server.App.costume_gallery(self)

    def _costume_item(self, cid):
        return server.App._costume_item(self, cid)

    def _costume_original(self, cid):
        return server.App._costume_original(self, cid)

    def upload(self, name, role, data, pid):
        self.uploads += 1
        aid = 'asset-%d' % self.uploads
        asset = {'id': aid, 'name': name, 'role': role, 'local': 'assets/%s.png' % aid}
        self.store.items.append(asset)
        return asset


def _app(tmp):
    return _App(tmp)


class CostumeGalleryTests(unittest.TestCase):
    def test_manifest_is_trimmed_and_self_consistent(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = server.App.costume_gallery(_app(tmp))
            self.assertEqual(data['count'], len(data['items']))
            self.assertEqual(len(data['categories']), 8)
            self.assertEqual(sum(c['count'] for c in data['categories']), data['count'])
            self.assertIn('ギア', data['author'])
            self.assertEqual(set(data['items'][0]), {'id', 'cat', 'kw', 'zh'})
            self.assertEqual(len({i['id'] for i in data['items']}), data['count'])

    def test_import_downloads_original_and_records_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)) as mocked:
                asset = server.App.import_gallery_costume(app, 'p1', 'SPR-0001')
            self.assertEqual(mocked.call_count, 1)
            self.assertEqual(asset['role'], 'outfit')
            self.assertEqual(asset['costume_id'], 'SPR-0001')
            self.assertEqual(asset['costume_meta']['source'], 'COSTUME-DB-01')
            self.assertIn('SPR-0001', asset['name'])
            self.assertIn('荷叶边', asset['name'] + asset['costume_meta']['keywords'])
            self.assertEqual(app.uploads, 1)
            self.assertTrue((app.store.root / 'costumes' / 'SPR-0001.png').is_file())

    def test_second_import_reuses_asset_without_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)):
                first = server.App.import_gallery_costume(app, 'p1', 'SPR-0001')
            with patch.object(server.urllib.request, 'urlopen', side_effect=AssertionError('不该重下')):
                second = server.App.import_gallery_costume(app, 'p1', 'SPR-0001')
            self.assertEqual(first['id'], second['id'])
            self.assertEqual(app.uploads, 1)

    def test_cached_original_skips_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)):
                first = server.App._costume_original(app, 'SPR-0002')
            with patch.object(server.urllib.request, 'urlopen', side_effect=AssertionError('不该重下')):
                second = server.App._costume_original(app, 'SPR-0002')
            self.assertEqual(first, second)
            self.assertFalse(first.with_name(first.name + '.part').exists())

    def test_unknown_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with self.assertRaises(ValueError):
                server.App.import_gallery_costume(app, 'p1', 'NOPE-9999')
            with self.assertRaises(ValueError):
                server.App.import_gallery_costume(app, 'p1', '')

    def test_bad_payload_leaves_nothing_behind(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(b'<html>nope</html>')):
                with self.assertRaisesRegex(ValueError, '下载失败'):
                    server.App.import_gallery_costume(app, 'p1', 'SPR-0003')
            self.assertEqual(app.uploads, 0)
            self.assertFalse((app.store.root / 'costumes' / 'SPR-0003.png').exists())
            self.assertFalse(list((app.store.root / 'costumes').glob('*.part')) if (app.store.root / 'costumes').exists() else [])

    def test_offline_error_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', side_effect=OSError('offline')), patch.object(server.time, 'sleep'):
                with self.assertRaisesRegex(ValueError, '下载失败'):
                    server.App.import_gallery_costume(app, 'p1', 'SPR-0004')
            self.assertEqual(app.uploads, 0)

    def test_trashed_asset_does_not_block_reimport(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)):
                first = server.App.import_gallery_costume(app, 'p1', 'SPR-0005')
            for item in app.store.items:
                if item['id'] == first['id']:
                    item['trashed'] = True
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)):
                second = server.App.import_gallery_costume(app, 'p1', 'SPR-0005')
            self.assertNotEqual(first['id'], second['id'])
            self.assertEqual(app.uploads, 2)


if __name__ == '__main__':
    unittest.main()
