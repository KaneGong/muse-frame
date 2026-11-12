"""Regression coverage for the portable workspace migration and rollback."""
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

DESIGN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(DESIGN), str(DESIGN.parents[1] / 'app')]

import beta_migration as migration
from beta_jobs import job_feed
from beta_store import WORKSPACE_ID, read_workspace
from store import Store

IMAGE = (DESIGN / 'assets/generated/plan-walking.webp').read_bytes()


class MigrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source = self.root / 'old app'
        self.profile = self.root / 'new app'
        self.store = self.open_store(self.source)
        self.store.put_project('原始项目', {'draft': '原始用户提示词'}, 'old-project')

    def open_store(self, path):
        store = Store(path)
        self.addCleanup(store.db.close)
        return store

    def image(self, name, role='output', pid='old-project', **metadata):
        path = 'assets/' + name + '.webp'
        (self.source / path).write_bytes(IMAGE)
        self.store.put_asset({'id': name, 'name': name, 'role': role, 'local': path,
                              'original_local': path, **metadata}, pid)
        return path

    def job(self, label, pid='old-project', **payload):
        return self.store.enqueue('fixture-' + label, pid, {'prompt': '原始提交 ' + label, 'platform': 'lovart',
            'model': 'fixture-model', 'mode': 'generate', 'resolution': '2K', 'aspect_ratio': '3:4', **payload})

    def native(self):
        state = {key: [] for key in ('assets', 'outputs', 'tasks', 'recipes', 'experiments', 'products', 'batches')}
        state['shoots'] = [{'id': 'shoot-1', 'title': '我的拍摄'}]
        self.store.put_project('工作台', {'workbench': {'state': state, 'ui': {'language': 'en'}}}, WORKSPACE_ID)

    def test_native_copy_preserves_draft_and_receipts_without_restart_replay(self):
        self.native()
        self.image('my-original')
        pending = self.job('queue')
        preparing = self.job('preparing')
        self.store.update(preparing['id'], state='preparing')
        paid = self.job('paid', prompt_contract={'version': 2, 'snapshot': {'manualText': 'Keep this wording'}})
        self.store.update(paid['id'], state='running', task_ids=['remote-task-id'], result={
            'project_id': 'original-platform-project', 'authorization': 'fixture-secret',
            'image_url': 'https://example.invalid/image?Signature=fixture-secret'})
        (self.source / 'tokens').mkdir()
        (self.source / 'tokens' / 'lovart.json').write_text('fixture-secret')
        self.store.db.execute('CREATE TABLE custom_credentials (cookie TEXT)')
        self.store.db.execute("INSERT INTO custom_credentials VALUES ('fixture-secret')")
        self.store.db.commit()
        source_stamp = migration._database_stamp(self.source)
        old_target = self.open_store(self.profile)
        old_target.put_project('existing draft', {}, 'existing')
        result = migration.migrate_workspace(self.profile, self.source)
        target = Path(result['workspace'])
        self.assertEqual(result['quarantined_jobs'], 3)
        self.assertEqual(migration._database_stamp(self.source), source_stamp)
        self.assertEqual(self.store.job(paid['id'])['state'], 'running')
        self.assertFalse((target / 'tokens').exists())
        self.assertNotIn(b'fixture-secret', (target / migration.DATABASE).read_bytes())
        moved = self.open_store(target)
        self.assertEqual(read_workspace(moved), read_workspace(self.store))
        self.assertEqual((target / 'assets/my-original.webp').read_bytes(), IMAGE)
        moved.recover()
        self.assertIsNone(moved.claim())
        self.assertEqual(moved.running_internal(), [])
        self.assertEqual(moved.job(pending['id'])['state'], 'cancelled')
        self.assertEqual(moved.job(preparing['id'])['state'], 'cancelled')
        receipt = moved.job(paid['id'])
        self.assertEqual(receipt['state'], 'needs_review')
        self.assertEqual(receipt['task_ids'], ['remote-task-id'])
        self.assertEqual(receipt['result']['project_id'], 'original-platform-project')
        self.assertEqual(receipt['payload']['prompt_contract'], paid['payload']['prompt_contract'])
        audit = moved.db.execute('SELECT state FROM workspace_migration_jobs WHERE id=?', (paid['id'],)).fetchone()
        self.assertEqual(audit[0], 'running')
        moved.put_project('new work after migration', {}, 'new-work')
        self.assertEqual(migration.rollback_workspace(self.profile)['workspace'], str(self.profile))
        self.assertEqual(old_target.project('existing')['name'], 'existing draft')
        self.assertEqual(migration.rollback_workspace(self.profile)['workspace'], str(target))
        self.assertEqual(moved.project('new-work')['name'], 'new work after migration')

    def test_legacy_projects_references_outputs_and_inherited_history_are_visible(self):
        self.image('face-ref', 'face')
        original = self.job('original', prompt_contract={'version': 2, 'shot_id': 'old-shot', 'snapshot': {'manualText': '冻结文本'}})
        output_file = self.image('original', job_id=original['id'])
        self.image('variant', source='retouched', parent_id='original', retouch_base_id='original', retouch_settings={'warmth': 0.2})
        self.store.update(original['id'], state='completed', result={'asset_ids': ['original']})
        self.store.put_project('共享项目', {}, 'shared-project')
        self.store._link('shared-project', 'original')
        self.store.set_project_data('shared-project', {'importedHistory': [self.store.job(original['id'])]})
        self.store.set_project_data('old-project', {'refs': {'face': 'face-ref'}, 'draft': '当前草稿', 'activeShot': 'old-shot',
            'shots': [{'id': 'old-shot', 'prompt': '当前草稿'}], 'promptSpec': {'version': 2, 'shots': [
                {'id': 'old-shot', 'mode': 'manual', 'manualText': '逐镜头原文'}]}})
        self.store.db.execute('CREATE TABLE analyses (id TEXT PRIMARY KEY, result TEXT)')
        self.store.db.execute("INSERT INTO analyses VALUES ('analysis-id', '旧版纯文本识图')")
        self.store.db.commit()
        output = migration.migrate_workspace(self.profile, self.source)
        target = self.open_store(output['workspace'])
        state = read_workspace(target)['state']
        shoot = next(shoot for shoot in state['shoots'] if shoot['id'] == 'old-project')
        self.assertEqual(shoot['model'], 'face-ref')
        self.assertEqual(shoot['shots'][0]['legacyPrompt'], '逐镜头原文')
        self.assertEqual(target.project('old-project')['data']['draft'], '当前草稿')
        original_work = next(work for work in state['outputs'] if work['id'] == 'original')
        adjustment = next(work for work in state['outputs'] if work['id'] == 'variant')
        shared = next(work for work in state['outputs'] if work['projectId'] == 'shared-project')
        self.assertEqual(original_work['shotId'], 'old-shot')
        self.assertEqual(adjustment['parentOutputId'], 'original')
        self.assertEqual(adjustment['editType'], 'local-adjustment')
        self.assertNotEqual(shared['id'], 'original')
        self.assertEqual(shared['nativeAssetId'], 'original')
        self.assertEqual((Path(output['workspace']) / output_file).read_bytes(), IMAGE)
        jobs = job_feed(target)['jobs']
        source_job = next(job for job in jobs if not job['readOnly'])
        inherited_job = next(job for job in jobs if job['readOnly'])
        self.assertEqual(source_job['id'], original['id'])
        self.assertEqual(source_job['promptContract']['snapshot']['manualText'], '冻结文本')
        self.assertEqual(inherited_job['sourceJobId'], original['id'])
        self.assertEqual(inherited_job['outputs'][0]['id'], shared['id'])
        self.assertEqual(target.db.execute('SELECT result FROM analyses').fetchone()[0], '旧版纯文本识图')

    def test_failed_migration_does_not_change_existing_target(self):
        self.native()
        missing = self.image('gone')
        (self.source / missing).unlink()
        self.assertEqual(migration.inspect_workspace(self.source)['missing'], 1)
        with self.assertRaises(migration.MigrationError):
            migration.migrate_workspace(self.profile, self.source)
        self.assertEqual(migration.active_workspace(self.profile), self.profile)
        self.assertFalse(migration.workspace_status(self.profile)['rollback_available'])

    def test_inventory_copies_files_named_by_encoded_and_legacy_windows_urls(self):
        self.native()
        workspace = read_workspace(self.store)
        workspace['state']['assets'] = [
            {'id': 'encoded', 'image': '/files/assets/One%20%231.webp?project_id=old-project'},
            {'id': 'legacy', 'image': r'/files/previews\old.webp?project_id=old-project'},
        ]
        workspace.pop('revision')
        self.store.set_project_data(WORKSPACE_ID, {'workbench': workspace})
        files = ['assets/One #1.webp', 'previews/old.webp']
        for name in files:
            (self.source / name).write_bytes(IMAGE)
        target = Path(migration.migrate_workspace(self.profile, self.source)['workspace'])
        for name in files:
            self.assertEqual((target / name).read_bytes(), IMAGE)

    def test_source_wal_change_during_copy_is_detected(self):
        self.native()
        original_copy = migration.shutil.copyfile

        def changed(*args):
            original_copy(*args)
            self.store.put_project('late draft', {}, 'late-draft')

        with patch.object(migration.shutil, 'copyfile', side_effect=changed):
            with self.assertRaisesRegex(migration.MigrationError, 'source changed'):
                migration.migrate_workspace(self.profile, self.source)
        self.assertFalse((self.profile / migration.POINTER).exists())
        self.assertEqual(self.store.project('late-draft')['name'], 'late draft')

    def test_source_media_replacement_before_database_capture_is_detected(self):
        self.native()
        path = self.source / self.image('changing')
        original_copy = migration.shutil.copyfile

        def changed(*args):
            original_copy(*args)
            path.write_bytes(IMAGE + b'replacement')

        with patch.object(migration.shutil, 'copyfile', side_effect=changed):
            with self.assertRaisesRegex(migration.MigrationError, 'source changed'):
                migration.migrate_workspace(self.profile, self.source)
        self.assertFalse((self.profile / migration.POINTER).exists())

    def test_interrupted_image_analysis_does_not_keep_target_busy(self):
        self.native()
        self.store.db.execute('CREATE TABLE analyses (id TEXT PRIMARY KEY, state TEXT, error TEXT, updated REAL)')
        self.store.db.execute("INSERT INTO analyses VALUES ('analysis-id', 'running', NULL, 42)")
        self.store.db.commit()
        result = migration.migrate_workspace(self.profile, self.source)
        copied = self.open_store(result['workspace'])
        self.assertEqual(result['quarantined_analyses'], 1)
        self.assertEqual(copied.db.execute('SELECT state FROM analyses').fetchone()[0], 'failed')
        self.assertEqual(copied.db.execute('SELECT state FROM workspace_migration_analyses').fetchone()[0], 'running')
        self.assertEqual(self.store.db.execute('SELECT state FROM analyses').fetchone()[0], 'running')

    def test_portable_backups_are_distinct_and_can_be_migrated(self):
        self.native()
        parent = self.root / 'exported backups'
        parent.mkdir()
        first = migration.backup_workspace(self.source, parent)
        second = migration.backup_workspace(self.source, parent)
        self.assertNotEqual(first['backup'], second['backup'])
        self.assertFalse((self.source / migration.POINTER).exists())
        self.assertEqual(migration.inspect_workspace(first['backup'])['format'], 'native')
        migrated = migration.migrate_workspace(self.profile, Path(first['backup']) / migration.DATABASE)
        self.assertEqual(migrated['shoots'], 1)

    def test_windows_relative_media_paths_are_normalized(self):
        self.native()
        path = self.image('win-asset')
        data = self.store.asset('win-asset')
        data['original_local'] = path.replace('/', '\\')
        self.store.put_asset(data)
        migrated = migration.migrate_workspace(self.profile, self.source)
        target = self.open_store(migrated['workspace'])
        self.assertEqual(target.asset('win-asset')['original_local'], path)
        self.assertEqual((Path(migrated['workspace']) / path).read_bytes(), IMAGE)

    def test_external_asset_symlink_is_rejected(self):
        self.native()
        relative = self.image('symlink')
        outside = self.root / 'elsewhere.webp'
        outside.write_bytes(IMAGE)
        (self.source / relative).unlink()
        (self.source / relative).symlink_to(outside)
        with self.assertRaisesRegex(migration.MigrationError, 'unsafe image path'):
            migration.migrate_workspace(self.profile, self.source)


if __name__ == '__main__':
    unittest.main()
