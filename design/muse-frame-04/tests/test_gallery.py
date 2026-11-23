"""Boundaries and recovery for the local public-gallery reader. No network calls."""
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gallery_server as gallery


class GalleryTests(unittest.TestCase):
    def setUp(self):
        self.cache = patch.object(gallery, '_cache_dir', None)
        self.cache.start()
        gallery._catalogs.clear()
        for rows in gallery._retired.values():
            rows.clear()

    def tearDown(self):
        self.cache.stop()
        gallery._catalogs.clear()

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
        old = (0, {'items': [{'id': 'old'}], 'fetchedAt': 100})
        with patch.dict(gallery._catalogs, {'person': old}, clear=True), patch.object(gallery, 'fetch', side_effect=TimeoutError):
            result = gallery.load_catalog('person', refresh=True)
            self.assertTrue(result['stale'])
            self.assertEqual(result['items'], old[1]['items'])
            self.assertEqual(result['fetchedAt'], 100)

    def test_outfit_updates_from_source_with_chinese_keywords(self):
        rows = [{'id': 'SPR-9999', 'カテゴリ': '春', 'キーワード': 'ivory new-fabric jacket',
                 'サムネ': 'thumbs/SPR-9999.webp', '原寸': 'img/SPR-9999.png'}]
        body = ('<script>const D = ' + json.dumps(rows) + ';const PAGE=120;</script>').encode()
        with patch.object(gallery, 'fetch', return_value=(body, 'text/html')) as fetch:
            result = gallery.load_catalog('outfit', True)
        self.assertEqual(fetch.call_args.args[0], gallery.SITES['outfit'])
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['items'][0]['name'], '象牙白·new-fabric·夹克')
        self.assertEqual(result['changes']['added'], 1)

    def test_pose_source_additions_survive_missing_translation(self):
        rows = [{'id': 'new_pose', '系統': '全身1人・標準系', 'ポーズ名': '新姿勢', '分類': '立ち',
                 'アングル': '正面', 'サムネ': 'thumbs/new.jpg', '原寸': 'img/new.png'}]
        body = ('const D=' + json.dumps(rows) + ';').encode()
        with patch.object(gallery, 'fetch', side_effect=[(body, 'text/html'), TimeoutError()]):
            result = gallery.load_catalog('pose', True)
        self.assertFalse(result['stale'])
        self.assertEqual(result['untranslated'], 1)
        self.assertEqual(result['items'][0]['system'], '全身单人・标准系')
        self.assertEqual(result['items'][0]['name'], '新姿勢')

    def test_snapshot_restart_offline_and_retired_image_lookup(self):
        def item(rid, name='original'):
            return {'id': rid, 'name': name, 'thumb': gallery.SITES['person']+'t/'+rid, 'image': gallery.SITES['person']+'i/'+rid}
        with tempfile.TemporaryDirectory() as directory, patch.object(gallery, '_cache_dir', Path(directory)):
            with patch.object(gallery, 'remote_items', return_value=([item('old'), item('same')], 0)):
                gallery.load_catalog('person', True)
            with patch.object(gallery, 'remote_items', return_value=([item('same', 'changed'), item('new')], 0)):
                result = gallery.load_catalog('person', True)
            self.assertEqual(result['changes'], {'added': 1, 'removed': 1, 'updated': 1})
            gallery._catalogs.clear()
            gallery._retired['person'].clear()
            with patch.object(gallery, 'remote_items', side_effect=TimeoutError()):
                result = gallery.load_catalog('person', True)
            self.assertTrue(result['stale'])
            self.assertEqual([x['id'] for x in result['items']], ['same', 'new'])
            with patch.object(gallery, 'fetch', return_value=(b'old-image', 'image/png')):
                self.assertEqual(gallery.image_bytes('person', 'old', 'image')[0], b'old-image')
            self.assertEqual([x.name for x in Path(directory).iterdir()], ['person.json'])

    def test_malformed_refresh_does_not_replace_disk_snapshot(self):
        item = {'id': 'ok', 'thumb': gallery.SITES['person']+'t', 'image': gallery.SITES['person']+'i'}
        with tempfile.TemporaryDirectory() as directory, patch.object(gallery, '_cache_dir', Path(directory)):
            with patch.object(gallery, 'remote_items', return_value=([item], 0)):
                gallery.load_catalog('person', True)
            before = (Path(directory)/'person.json').read_bytes()
            with patch.object(gallery, 'fetch', return_value=(b'not a catalog', 'text/html')):
                self.assertTrue(gallery.load_catalog('person', True)['stale'])
            self.assertEqual(before, (Path(directory)/'person.json').read_bytes())

    def test_empty_duplicate_or_foreign_items_are_rejected(self):
        item = {'id': 'ok', 'thumb': 't', 'image': 'i'}
        for rows in ([], [dict(item), dict(item)], [{**item, 'image': 'https://example.com/x'}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                gallery.checked_items('person', rows)

    def test_bundle_is_available_offline_without_claiming_recent_sync(self):
        with patch.object(gallery, 'fetch', side_effect=TimeoutError()):
            result = gallery.load_catalog('outfit', True)
        self.assertTrue(result['stale'])
        self.assertEqual(result['fetchedAt'], 0)
        self.assertGreater(result['count'], 0)

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
