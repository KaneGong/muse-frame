"""生成结果缺本地副本时，hosted 必须能从 url 补齐，而不是抛 KeyError('local')。"""
import io, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('PORTRAIT_STUDIO_DATA', tempfile.mkdtemp())
import server

# 1x1 PNG
PNG = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
       b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00'
       b'\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82')


class _Store:
    def __init__(self, root):
        self.root = Path(root)
        self.saved = []

    def put_asset(self, a):
        self.saved.append(dict(a))


class _App:
    pass


def _app(root):
    app = _App()
    app.store = _Store(root)
    return app


class AssetLocalTests(unittest.TestCase):
    def test_existing_local_file_is_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            target = app.store.root / 'previews' / 'x.png'
            target.parent.mkdir(parents=True)
            target.write_bytes(PNG)
            got = server.App._asset_local(app, 'x', {'local': 'previews/x.png'})
            self.assertEqual(Path(got), target)

    def test_missing_local_downloads_from_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            asset = {'url': 'https://cdn.example/x.png'}

            class _Response(io.BytesIO):
                headers = {'Content-Type': 'image/png'}

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

            with patch.object(server.urllib.request, 'urlopen', return_value=_Response(PNG)):
                got = server.App._asset_local(app, 'x', asset)
            self.assertTrue(Path(got).exists())
            self.assertEqual(Path(got).read_bytes(), PNG)
            # 补齐后应写回资产，下次直接用
            self.assertEqual(asset.get('local'), 'assets/x.jpg')
            self.assertTrue(app.store.saved)

    def test_no_local_and_no_url_raises_readable_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with self.assertRaises(ValueError) as ctx:
                server.App._asset_local(app, 'x', {})
            self.assertIn('重新上传', str(ctx.exception))

    def test_download_failure_raises_readable_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = _app(tmp)
            with patch.object(server.urllib.request, 'urlopen', side_effect=OSError('boom')):
                with self.assertRaises(ValueError) as ctx:
                    server.App._asset_local(app, 'x', {'url': 'https://cdn.example/x.png'})
            self.assertIn('自动下载也失败', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
