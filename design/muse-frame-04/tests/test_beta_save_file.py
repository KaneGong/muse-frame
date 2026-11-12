"""Saving only targets the chosen folder and preserves existing files."""
import io
from email.message import Message
from types import SimpleNamespace
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from beta_save_file import copy_to_folder, export_name, save_file


class SaveFileTests(unittest.TestCase):
    def test_uses_chosen_folder_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / '作品.png').write_bytes(b'old')
            name = copy_to_folder(io.BytesIO(b'new'), folder, '作品.png')
            self.assertEqual(name, '作品 (2).png')
            self.assertEqual((folder / '作品.png').read_bytes(), b'old')
            self.assertEqual((folder / name).read_bytes(), b'new')
            self.assertEqual(len(list(folder.iterdir())), 2)

    def test_sanitizes_names_and_refuses_other_file_types(self):
        self.assertEqual(export_name(quote('../一套:作品.PNG')), '-一套-作品.png')
        with self.assertRaises(ValueError):
            export_name('script.command')

    def test_same_origin_endpoint_saves_only_after_the_picker_returns_a_folder(self):
        data = b'{"saved":true}'
        headers = Message()
        headers["Host"] = "127.0.0.1:9017"
        headers["Origin"] = "http://127.0.0.1:9017"
        headers["Content-Type"] = "application/octet-stream"
        headers["Content-Length"] = str(len(data))
        headers["X-Muse-Export-Name"] = "example.json"
        handler = SimpleNamespace(valid_host=lambda:True, headers=headers, connection=Mock(),
                                  rfile=io.BytesIO(data), send=lambda body, status=200:(body, status))
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            with patch("beta_save_file.sys.platform", "darwin"), patch("beta_save_file.choose_folder", return_value=folder) as picker:
                self.assertEqual(save_file(handler), ({"name":"example.json", "folder":folder.name}, 200))
                self.assertEqual((folder / "example.json").read_bytes(), data)
                picker.return_value = None
                handler.rfile.seek(0)
                self.assertEqual(save_file(handler), ({"cancelled":True}, 200))
                self.assertEqual([item.name for item in folder.iterdir()], ["example.json"])
