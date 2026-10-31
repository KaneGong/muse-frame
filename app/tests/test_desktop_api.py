import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop


class FakeWindow:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def create_file_dialog(self, dialog_type, directory='', save_filename=''):
        self.calls.append({'type': dialog_type, 'directory': directory, 'name': save_filename})
        return self.result


class DesktopApiTests(unittest.TestCase):
    def test_every_save_asks_the_native_panel_and_writes_the_chosen_path(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HOME': home}):
            target = Path(home) / 'Photos' / '作品.png'
            api = desktop.DesktopApi(8765, home)
            api.window = FakeWindow((str(target),))
            result = api.save_bytes('作品', base64.b64encode(b'ABC').decode())
            self.assertTrue(result['ok'])
            self.assertEqual(Path(result['path']), target)
            self.assertEqual(target.read_bytes(), b'ABC')
            self.assertEqual(api.window.calls[0]['name'], '作品')
            self.assertEqual(api.window.calls[0]['directory'], str(Path(home) / 'Downloads'))
            self.assertEqual(api._settings()['last_save_dir'], str(target.parent))

    def test_canceling_the_panel_writes_nothing(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HOME': home}):
            api = desktop.DesktopApi(8765, home)
            api.window = FakeWindow(None)
            result = api.save_bytes('作品.bin', base64.b64encode(b'ABC').decode())
            self.assertEqual(result, {'ok': False, 'cancelled': True})
            self.assertEqual(list(Path(home).rglob('作品.bin')), [])

    def test_next_panel_opens_in_the_last_chosen_folder(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HOME': home}):
            first = Path(home) / 'A' / 'one.png'
            second = Path(home) / 'A' / 'two.png'
            api = desktop.DesktopApi(8765, home)
            api.window = FakeWindow((str(first),))
            api.save_bytes('one', base64.b64encode(b'1').decode())
            api.window = FakeWindow((str(second),))
            api.save_bytes('two', base64.b64encode(b'2').decode())
            self.assertEqual(api.window.calls[0]['directory'], str(first.parent))

    def test_chosen_existing_file_is_overwritten_after_panel_confirmation(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HOME': home}):
            target = Path(home) / 'existing.png'
            target.write_bytes(b'old')
            api = desktop.DesktopApi(8765, home)
            api.window = FakeWindow((str(target),))
            api.save_bytes('existing.png', base64.b64encode(b'new').decode())
            self.assertEqual(target.read_bytes(), b'new')

    def test_download_paths_must_stay_on_the_local_server(self):
        api = desktop.DesktopApi(8765, '/tmp')
        for bad in ['http://evil.example/x', '//evil.example/x', '../assets/x', '', 'https://x/y']:
            with self.assertRaises(ValueError):
                api.save_download('x', bad)

    def test_names_are_sanitized_and_extensions_follow_content_type(self):
        self.assertEqual(desktop.DesktopApi._safe('../../etc/passwd'), 'passwd')
        self.assertEqual(desktop.DesktopApi._safe('a:b*c?.png'), 'a_b_c_.png')
        self.assertEqual(desktop.DesktopApi._with_extension('作品', 'image/png'), '作品.png')
        self.assertEqual(desktop.DesktopApi._with_extension('作品.jpg', 'image/png'), '作品.jpg')
        self.assertEqual(desktop.DesktopApi._with_extension('项目包', 'application/zip'), '项目包.zip')
        self.assertEqual(desktop.DesktopApi._path_suffix('/files/a.png?project_id=x'), '.png')

    def test_invalid_base64_is_rejected(self):
        api = desktop.DesktopApi(8765, '/tmp')
        with self.assertRaises(ValueError):
            api.save_bytes('x.bin', 'not-base64!!!')

    def test_selftest_auto_save_skips_the_dialog(self):
        with tempfile.TemporaryDirectory() as home:
            auto = Path(home) / 'auto'
            api = desktop.DesktopApi(8765, home, auto_save_dir=auto)
            first = api.save_bytes('作品.bin', base64.b64encode(b'1').decode())
            second = api.save_bytes('作品.bin', base64.b64encode(b'2').decode())
            self.assertTrue(Path(first['path']).is_file())
            self.assertNotEqual(first['path'], second['path'])
            self.assertEqual(Path(first['path']).parent, auto)


if __name__ == '__main__':
    unittest.main()
