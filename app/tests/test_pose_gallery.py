"""在线姿势库：清单缓存、按需下载、去重导入。"""
import io, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('PORTRAIT_STUDIO_DATA', tempfile.mkdtemp())
import server

PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64
ITEMS = [{
    'id': 'full_single_P001_front', '体系': '全身单人・标准系', '姿势编号': 'P001',
    '分类': '坐姿', '姿势名称': '后仰坐・单膝立起', '角度': '正面',
    '缩略图': 'thumbs/full_single_P001_front.jpg', '原图': 'img/full_single_P001_front.png',
}]


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

    def _gallery_cache(self):
        return server.App._gallery_cache(self)

    def pose_gallery(self, refresh=False):
        return server.App.pose_gallery(self, refresh)

    def upload(self, name, role, data, pid):
        self.uploads += 1
        aid = 'asset-%d' % self.uploads
        asset = {'id': aid, 'name': name, 'role': role, 'local': 'assets/%s.png' % aid}
        self.store.items.append(asset)
        return asset


def _app(tmp):
    app = _App(tmp)
    cache = app.store.root / 'pose-gallery' / 'pose-zh.json'
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(ITEMS, ensure_ascii=False))
    return app


class PoseGalleryTests(unittest.TestCase):
    def test_manifest_is_trimmed_and_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            data = server.App.pose_gallery(app)
            self.assertEqual(len(data['items']), 1)
            first = data['items'][0]
            self.assertEqual(first['name'], '后仰坐・单膝立起')
            self.assertEqual(first['cat'], '坐姿')
            self.assertEqual(first['orig'], 'img/full_single_P001_front.png')
            self.assertEqual(data['source'], 'anhao/ai-pose-gallery-zh')
            self.assertIn('ギア', data['author'])
            # 缓存新鲜时不应再联网
            with patch.object(server.urllib.request, 'urlopen', side_effect=AssertionError('不该联网')):
                again = server.App.pose_gallery(app)
            self.assertEqual(len(again['items']), 1)

    def test_manifest_falls_back_to_cache_when_network_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            # 让缓存过期
            os.utime(app.store.root / 'pose-gallery' / 'pose-zh.json', (0, 0))
            with patch.object(server.urllib.request, 'urlopen', side_effect=OSError('offline')):
                data = server.App.pose_gallery(app)
            self.assertEqual(len(data['items']), 1)

    def test_import_downloads_original_and_records_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)) as fetch:
                asset = server.App.import_gallery_pose(app, 'p1', 'full_single_P001_front')
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(fetch.call_args.args[0].full_url, 'https://ai-pose-gallery.pages.dev/img/full_single_P001_front.png')
            self.assertEqual(asset['role'], 'pose')
            self.assertEqual(asset['gallery_id'], 'full_single_P001_front')
            self.assertIn('后仰坐', asset['name'])
            self.assertIn('正面', asset['name'])
            self.assertEqual(asset['gallery_meta']['cat'], '坐姿')
            self.assertEqual(app.uploads, 1)

    def test_second_import_reuses_existing_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', return_value=_Resp(PNG)):
                first = server.App.import_gallery_pose(app, 'p1', 'full_single_P001_front')
            with patch.object(server.urllib.request, 'urlopen', side_effect=AssertionError('不该重下')):
                second = server.App.import_gallery_pose(app, 'p1', 'full_single_P001_front')
            self.assertEqual(first['id'], second['id'])
            self.assertEqual(app.uploads, 1)

    def test_unknown_or_bad_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with self.assertRaises(ValueError):
                server.App.import_gallery_pose(app, 'p1', '')
            with self.assertRaises(ValueError):
                server.App.import_gallery_pose(app, 'p1', 'x' * 200)

    def test_download_failure_raises_readable_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', side_effect=OSError('boom')):
                with self.assertRaises(ValueError) as ctx:
                    server.App.import_gallery_pose(app, 'p1', 'full_single_P001_front')
            self.assertIn('下载失败', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
