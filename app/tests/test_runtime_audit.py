"""Deterministic runtime regressions using only synthetic local data."""
import copy
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store
import libtv_direct


class Cycles:
    def __init__(self, count):self.count=count
    def wait(self, _):self.count-=1;return self.count<0


class RuntimeAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(self.tmp.name);self.addCleanup(self.store.db.close)
        self.app=App.__new__(App);self.app.store=self.store
        self.app.platform='libtv';self.app.execution_lock=threading.RLock()
        self.app.status={'state':'connected'}
        self.project=self.store.put_project('Synthetic',{'refs':{},'draft':'before'})

    def job(self, key, platform='libtv'):
        return self.store.enqueue(key,self.project['id'],{
            'model':'synthetic','prompt':'synthetic','mode':'generate',
            'aspect_ratio':'default','resolution':'default','refs':[],
            'resultRole':'scene','platform':platform})

    def test_libtv_binds_every_reference_to_the_current_canvas_after_reconnect(self):
        pid = self.project['id']
        old_canvas, current_canvas = 'old-canvas', 'current-canvas'
        self.store.set_project_data(pid, {'platform_projects': {'libtv': old_canvas}})
        bridge = libtv_direct.LibTVBridge()
        bridge.project = current_canvas
        bridge.token = {'sub': 'test-account'}
        bridge.connect = lambda: None
        self.app.bridge = bridge
        self.app.model_schema = lambda *_: {'properties': {}}
        roles = ['face', 'body', 'outfit', 'scene', 'pose']
        uploads, generations = [], []

        def tool(name, args):
            if 'projectId' in args:
                self.assertEqual(args['projectId'], current_canvas)
            if name == 'upload_ticket':
                role = Path(args['file_name']).stem
                uploads.append(role)
                return {'parts': [{'url': 'https://upload.invalid/'}], 'path': role}
            if name == 'upload_complete':
                return {'file_ref': args['path']}
            if name == 'upload_media':
                return {'nodeId': 'current-' + args['fileRef']}
            if name == 'read_node':
                return {'node': {'data': {'url': f"https://libtv-res.liblib.art/{args['node']}.png"}}}
            if name == 'get_model':
                return {'schema': {'properties': {}}}
            if name == 'create_node':
                generations.append(args)
                return {'nodeId': 'output', 'taskId': 'accepted-task'}
            self.fail(name)

        bridge.tool = tool
        with patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': self.tmp.name}), patch.object(libtv_direct, '_put'):
            for i, role in enumerate(roles):
                canvas = current_canvas if role == 'pose' else old_canvas
                node = ('current-' if role == 'pose' else 'old-') + role
                url = f'https://libtv-res.liblib.art/{node}.png'
                local = f'assets/{role}.png'
                Image.new('RGB', (8, 8), (20 * i, 50, 80)).save(self.store.root / local)
                self.store.put_asset({'id': role, 'role': role, 'name': role, 'source': 'uploaded',
                    'local': local, 'url': url, 'platform_node_id': node,
                    'platform_project_id': canvas, 'account_key': 'test-account'}, pid)
                libtv_direct._remember_node(url, node, canvas, 'test-account')

            prompt = 'Synthetic portrait with five ordered references'
            for key in ('first-after-reconnect', 'second-after-reconnect'):
                job = self.store.enqueue(key, pid, {
                    'platform': 'libtv', 'model': 'fixture', 'mode': 'generate', 'prompt': prompt,
                    'refs': roles, 'resultRole': 'output', 'aspect_ratio': 'default', 'resolution': 'default',
                })
                self.app.submit(job)
                saved = self.store.job(job['id'])
                self.assertEqual(saved['state'], 'running', saved['error'])
                self.assertEqual(saved['task_ids'], ['accepted-task'])
                self.assertEqual(saved['result']['project_id'], current_canvas)

        self.assertEqual(uploads, roles[:-1])
        self.assertEqual(len(generations), 2)
        self.assertEqual(self.store.project(pid)['data']['platform_projects']['libtv'], current_canvas)
        for request in generations:
            nodes = ['current-' + role for role in roles]
            self.assertEqual(request['left'], nodes)
            self.assertEqual(request['prompt'].splitlines()[0],
                '参考图映射：' + '；'.join(f'图{i}={{{{Node {node}}}}}' for i, node in enumerate(nodes, 1)) + '。')
            self.assertEqual(request['prompt'].splitlines()[1], prompt)

    def test_platform_response_does_not_overwrite_concurrent_draft_edit(self):
        job=self.job('draft-race')
        self.app.model_schema=lambda *_:{'properties':{}}
        store=self.store;pid=self.project['id']
        class Bridge:
            def call(self,name,args):
                self.assert_name=name
                store.put_project('Renamed',{'refs':{},'draft':'typed during request','shots':[{'id':'new'}]},pid)
                return {'structuredContent':{'task_ids':['existing-task'],'project_id':'remote-new'}}
        self.app.bridge=Bridge();self.app.submit(job)
        after=self.store.project(pid)
        self.assertEqual(after['data']['draft'],'typed during request')
        self.assertEqual(after['data']['shots'],[{'id':'new'}])
        self.assertEqual(after['data']['platform_projects'],{'libtv':'remote-new'})
        self.assertEqual(self.store.job(job['id'])['state'],'running')

    def test_stale_page_save_keeps_backend_platform_mapping(self):
        old=copy.deepcopy(self.project)
        self.store.set_project_data(old['id'],{**old['data'],'platform_projects':{'libtv':'fresh'}})
        saved=self.store.put_project('User edit',{**old['data'],'draft':'new draft'},old['id'],old['revision'])
        self.assertEqual(saved['data']['draft'],'new draft')
        self.assertEqual(saved['data']['platform_projects'],{'libtv':'fresh'})

    def test_accepted_task_ids_survive_platform_metadata_write_failure(self):
        job=self.job('mapping-write-error');self.app.model_schema=lambda *_:{'properties':{}}
        class Bridge:
            calls=0
            def call(self,name,args):
                self.calls+=1
                return {'structuredContent':{'task_ids':['accepted-task'],'project_id':'remote-project'}}
        self.app.bridge=Bridge()
        def fail(*_):raise RuntimeError('synthetic metadata disk failure')
        self.store.set_project_data=fail
        self.app.submit(job)
        saved=self.store.job(job['id'])
        self.assertEqual(saved['state'],'needs_review')
        self.assertEqual(saved['task_ids'],['accepted-task'])
        self.assertEqual(saved['result']['project_id'],'remote-project')
        self.assertEqual(self.app.bridge.calls,1)
        self.assertIsNone(self.store.claim())

    def test_background_mapping_and_user_revision_remain_project_scoped(self):
        other=self.store.put_project('Other',{'refs':{},'platform_projects':{'lovart':'other-id'}})
        original_revision=self.project['revision']
        data={**self.project['data'],'platform_projects':{'libtv':'new-id','lovart':'existing-id'}}
        self.store.set_project_data(self.project['id'],data)
        self.assertEqual(self.store.project(self.project['id'])['revision'],original_revision)
        edited=self.store.put_project('Edited',{**self.project['data'],'draft':'user text'},self.project['id'],original_revision)
        self.assertEqual(edited['data']['platform_projects'],data['platform_projects'])
        self.assertEqual(self.store.project(other['id'])['data']['platform_projects'],{'lovart':'other-id'})
        with self.assertRaises(ValueError):
            self.store.put_project('Stale',self.project['data'],self.project['id'],original_revision)

    def test_failing_old_platform_poll_does_not_disconnect_current_platform(self):
        current=self.job('new-platform','libtv');old=self.job('old-platform','lovart')
        self.store.update(old['id'],state='running',task_ids=['old-task'])
        self.store.update(current['id'],state='running',task_ids=['new-task'])
        self.store.db.execute('update jobs set updated=? where id=?',(time.time()-60,old['id']))
        self.store.db.execute('update jobs set updated=? where id=?',(time.time()-30,current['id']))
        self.store.db.commit()
        class Bridge:
            closed=0
            def close(self):self.closed+=1
        self.app.bridge=Bridge();self.app.stop=Cycles(1)
        def poll(job):raise RuntimeError('synthetic old-platform outage')
        self.app.poll=poll;self.app.worker()
        self.assertEqual(self.app.status['state'],'connected')
        self.assertEqual(self.app.bridge.closed,0)

    def test_failed_poll_preserves_task_and_allows_other_due_tasks_to_progress(self):
        first=self.job('poll-fails');second=self.job('poll-succeeds')
        for job in (first,second):self.store.update(job['id'],state='running',task_ids=['existing-'+job['id']])
        self.store.db.execute('update jobs set updated=? where id=?',(time.time()-60,first['id']))
        self.store.db.execute('update jobs set updated=? where id=?',(time.time()-30,second['id']))
        self.store.db.commit()
        class Bridge:
            def close(self):pass
        self.app.bridge=Bridge();self.app.stop=Cycles(2);polled=[]
        def poll(job):
            polled.append(job['id'])
            if job['id']==first['id']:raise RuntimeError('synthetic transient read failure')
            self.store.update(job['id'],state='completed')
        self.app.poll=poll;self.app.worker()
        self.assertEqual(polled,[first['id'],second['id']])
        saved=self.store.job(first['id'])
        self.assertEqual(saved['state'],'running')
        self.assertEqual(saved['task_ids'],['existing-'+first['id']])
        self.assertIn('synthetic transient read failure',saved['error'])

    def test_project_overview_does_not_hydrate_every_image_and_job(self):
        pid=self.project['id']
        for index in range(200):
            self.store.put_asset({'id':f'asset-{index}','name':f'Image {index}',
                'role':'output' if index%2 else 'face','preview':f'/preview-{index}'},pid)
        self.store.asset_action(pid,['asset-199','asset-198'],{'trashed':True})
        for index in range(100):self.job(f'overview-{index}')
        statements=[];self.store.db.set_trace_callback(statements.append)
        try:overview,=self.store.projects()
        finally:self.store.db.set_trace_callback(None)
        self.assertEqual(overview['asset_count'],198)
        self.assertEqual(overview['work_count'],99)
        self.assertEqual(overview['task_count'],100)
        self.assertEqual(overview['cover'],'/preview-197')
        reads=[s for s in statements if s.lstrip().lower().startswith('select')]
        self.assertLess(len(reads),15,'project overview should not issue one query per image or task')

    def test_project_overview_preserves_reused_asset_metadata_and_cover_order(self):
        pid=self.project['id'];other=self.store.put_project('Other',{'refs':{}})['id']
        self.store.put_asset({'id':'face','name':'Reference','role':'face','preview':'/face'},pid)
        self.store.put_asset({'id':'work','name':'Work','role':'output','preview':'/work'},pid)
        self.store.reuse(pid,other,['face','work'])
        self.store.asset_action(other,['work'],{'trashed':True})
        self.store.project_action(other,'archive')
        rows={p['id']:p for p in self.store.projects()}
        self.assertEqual((rows[pid]['asset_count'],rows[pid]['work_count'],rows[pid]['cover']),(2,1,'/work'))
        self.assertEqual((rows[other]['asset_count'],rows[other]['work_count'],rows[other]['cover']),(1,0,'/face'))
        self.assertEqual(rows[other]['status'],'archived')
        self.store.asset_action(pid,['face','work'],{'trashed':True})
        row=next(p for p in self.store.projects() if p['id']==pid)
        self.assertEqual((row['asset_count'],row['work_count'],row['cover']),(0,0,None))


if __name__=='__main__':unittest.main()
