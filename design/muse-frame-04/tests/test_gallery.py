"""Boundaries and recovery for the local public-gallery reader. No network calls."""
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gallery_server as gallery


class GalleryTests(unittest.TestCase):
    def test_person_catalog_preserves_source_hair_metadata_for_filters(self):
        rows = [{"id": "face1", "section": "face", "hair": "セミロング", "style": "前髪あり"},
                {"id": "style2", "section": "styling", "hair": "ショート", "style": ""}]
        raw = ("const images = " + json.dumps(rows, ensure_ascii=False) + ";").encode()
        with patch.dict(gallery._catalogs, {}, clear=True), patch.object(gallery, "fetch", return_value=(raw, "text/javascript")):
            items = gallery.public_catalog("person")["items"]
        self.assertEqual([(item["category"], item["hair"], item["style"]) for item in items],
                         [("面部", "セミロング", "前髪あり"), ("造型", "ショート", "")])

    def test_images_cannot_redirect_to_arbitrary_hosts(self):
        for path in ('https://example.com/private', '//localhost/secret', 'http://ai-pose-gallery.pages.dev/x'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                gallery.source_url('pose', path)
        self.assertTrue(gallery.source_url('pose', 'img/test.jpg').startswith(gallery.SITES['pose']))

    def test_public_catalog_is_copy_with_traceable_source(self):
        source = {'items': [{'id': 'p1', 'thumb': 'https://example/t', 'image': 'https://example/i'}]}
        with patch.object(gallery, 'load_catalog', return_value=source):
            result = gallery.public_catalog('pose')
        self.assertEqual(source['items'][0]['thumb'], 'https://example/t')
        self.assertEqual(result['items'][0]['sourceImage'], 'https://example/i')
        self.assertIn('kind=pose&id=p1&size=thumb', result['items'][0]['thumb'])

    def test_only_catalog_items_can_be_requested(self):
        with patch.object(gallery, 'load_catalog', return_value={'items': []}), patch.object(gallery, 'fetch') as fetch:
            with self.assertRaises(ValueError):
                gallery.image_bytes('pose', 'https://example/private', 'image')
            fetch.assert_not_called()

    def test_failed_catalog_refresh_preserves_previous_cache(self):
        old = (0, {'items': [{'id': 'old'}]})
        with patch.dict(gallery._catalogs, {'person': old}, clear=True), patch.object(gallery, 'fetch', side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                gallery.load_catalog('person', refresh=True)
            self.assertEqual(gallery._catalogs['person'], old)

    def test_original_images_are_not_cached(self):
        item = {'id': 'p1', 'image': 'https://example/original'}
        with patch.object(gallery, 'load_catalog', return_value={'items': [item]}), patch.object(gallery, 'fetch', return_value=(b'png-data', 'image/png')), patch.dict(gallery._images, {}, clear=True):
            self.assertEqual(gallery.image_bytes('pose', 'p1', 'image'), (b'png-data', 'image/png'))
            self.assertEqual(len(gallery._images), 0)

    def test_non_image_response_does_not_become_an_asset(self):
        with patch.object(gallery, 'load_catalog', return_value={'items': [{'id': 'p1', 'image': 'https://example/html'}]}), patch.object(gallery, 'fetch', return_value=(b'not-image', 'text/html')):
            with self.assertRaises(ValueError):
                gallery.image_bytes('pose', 'p1', 'image')


if __name__ == '__main__':
    unittest.main()
