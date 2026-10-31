import base64,io,json,sys,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App,Handler
from agent_channel import AgentError
from http.server import ThreadingHTTPServer
from PIL import Image

def image():
    out=io.BytesIO();Image.new('RGB',(32,48),(120,100,80)).save(out,'PNG');return base64.b64encode(out.getvalue()).decode()
MODELS=[{'name':'test/model','schema':{'type':'object','properties':{'aspect_ratio':{'enum':['2:3']},'resolution':{'enum':['1K']}}},'capabilities':['generate','references','edit']}]
class AgentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.app=App(self.root);self.app.stop.set();self.channel=self.app.agent_channel
        self.pid=self.app.store.put_project('隔离测试',{'refs':{}})['id'];self.other=self.app.store.put_project('另一个项目',{'refs':{}})['id']
        self.channel.configure({'enabled':True,'project_id':self.pid,'platform':'模拟平台（不调用真实服务）'})
        self.session='test-session-123';self.call('studio_register',agent_name='SDK模拟执行器',models=MODELS)
        self.patch=patch.object(self.app.bridge,'call',side_effect=AssertionError('External route must never call Codex'));self.patch.start()
    def tearDown(self):self.patch.stop();self.app.stop.set();self.app.bridge.close();self.app.store.db.close();self.tmp.cleanup()
    def call(self,tool,**p):
        if tool=='studio_register' and 'catalog_summary' not in p:p['catalog_summary']={'discovered_count':len(p.get('models',[])),'excluded':[]}
        return self.channel.call(tool,{**p,'session':self.session})
    def test_uncertain_old_job_does_not_block_new_queue(self):
        old=self.enqueue();claimed=self.claim();self.progress(claimed,'needs_review',message='保留旧任务，不重新生成')
        self.enqueue();new=self.claim()
        self.assertIsNotNone(new)
        self.assertNotEqual(claimed['id'],new['id'])
        self.assertEqual(self.app.store.job(claimed['id'])['state'],'needs_review')

    def enqueue(self,**fields):
        import uuid
        payload={'prompt':'一处安静的摄影环境','mode':'generate','resultRole':'scene','model':'test/model','aspect_ratio':'2:3','resolution':'1K','refs':[],**fields}
        return self.app.enqueue({'project_id':self.pid,'request_key':uuid.uuid4().hex,'payload':payload})
    def claim(self):return self.call('studio_claim')['job']
    def progress(self,j,phase,**p):return self.call('studio_progress',job_id=j['id'],claim_id=j['claim_id'],phase=phase,**p)
    def test_full_lifecycle_and_idempotent_result(self):
        self.enqueue();j=self.claim();self.assertIsNone(self.claim());self.progress(j,'submitting');self.progress(j,'running',task_ids=['platform-task-1'])
        args={'job_id':j['id'],'claim_id':j['claim_id'],'image_base64':image()};r=self.call('studio_complete',**args)
        self.assertTrue(self.call('studio_complete',**args)['duplicate']);self.assertEqual(self.app.store.job(j['id'])['state'],'completed')
        a=self.app.store.asset(r['asset_id'],self.pid);self.assertEqual(a['original_size'],[32,48]);self.assertTrue((self.root/a['original_local']).is_file());self.assertEqual(len(self.app.store.assets(self.pid)),1)
    def test_original_route_never_claims_external(self):self.enqueue();self.assertIsNone(self.app.store.claim())
    def test_no_repeated_generation_after_ambiguous_submit(self):
        self.enqueue();j=self.claim();self.progress(j,'submitting')
        with self.assertRaises(AgentError):self.progress(j,'submitting')
        self.progress(j,'needs_review',message='未确定是否扣费')
        with self.assertRaises(AgentError):self.progress(j,'submitting')
    def test_result_requires_submitting(self):
        self.enqueue();j=self.claim()
        with self.assertRaises(AgentError):self.call('studio_complete',job_id=j['id'],claim_id=j['claim_id'],image_base64=image())
    def test_claim_atomic_across_threads(self):
        self.enqueue();results=[]
        threads=[threading.Thread(target=lambda:results.append(self.claim())) for _ in range(8)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(sum(bool(x) for x in results),1)
    def test_second_executor_cannot_take_online_session(self):
        with self.assertRaises(AgentError):self.channel.call('studio_register',{'session':'different-session','agent_name':'second','models':MODELS})
    def test_foreign_claim_rejected(self):
        self.enqueue();j=self.claim()
        with self.assertRaises(AgentError):self.call('studio_job',job_id=j['id'],claim_id='wrong')
    def test_other_project_not_authorized(self):
        self.pid=self.other
        with self.assertRaises(ValueError):self.enqueue()
    def test_cancel_queued_and_refuse_cancel_claimed(self):
        a=self.enqueue();self.app.cancel(self.pid,a['id']);self.assertEqual(self.app.store.job(a['id'])['state'],'cancelled')
        self.enqueue();j=self.claim()
        self.app.cancel(self.pid,j['id']);self.assertTrue(self.channel.control(j['id'])['cancel_requested'])
    def test_busy_prevents_reconfiguration(self):
        self.enqueue()
        with self.assertRaises(AgentError):self.channel.configure({'enabled':False})
    def test_revoke_rotates_access(self):
        old=self.channel.secret.read_text();self.assertTrue(self.channel.authorized(old));self.channel.configure({'enabled':False});self.assertFalse(self.channel.authorized(old))
        self.channel.configure({'enabled':True,'project_id':self.pid,'platform':'另个平台'});self.assertFalse(self.channel.authorized(old))
    def test_restart_never_requeues_claimed_task(self):
        self.enqueue();j=self.claim();self.progress(j,'submitting');self.app.store.recover();self.assertEqual(self.app.store.job(j['id'])['state'],'needs_review');self.assertIsNone(self.claim())
        resumed=self.call('studio_resume',job_id=j['id'])['job'];self.assertEqual(resumed['state'],'needs_review')
        with self.assertRaises(AgentError):self.progress(resumed,'submitting')
    def test_reference_scoped_to_claim(self):
        a=self.app.upload('测试人物','source',image(),self.pid);b=self.app.upload('其他照片','source',image(),self.pid)
        self.enqueue(refs=[a['id']]);j=self.claim();args={'job_id':j['id'],'claim_id':j['claim_id']}
        self.assertEqual(self.call('studio_reference',**args,asset_id=a['id'])['base64'],image())
        with self.assertRaises(AgentError):self.call('studio_reference',**args,asset_id=b['id'])
    def test_no_implicit_codex_connection_or_analysis(self):
        from runtime import EDITION
        if EDITION=='standalone':
            # The standalone edition owns its platform link; it must never fall back
            # to Codex, and pose analysis stays unavailable until a vision backend
            # is configured explicitly.
            self.assertEqual(self.app.bridge.__class__.__name__,'LovartDirect')
            with self.assertRaises(ValueError):self.app.start_analysis(self.pid,'unused')
        else:
            with self.assertRaises(ValueError):self.app.connect()
            with self.assertRaises(ValueError):self.app.start_analysis(self.pid,'unused')
    def test_unsupported_edit_and_references_rejected(self):
        self.call('studio_register',agent_name='limited',models=[{**MODELS[0],'capabilities':['generate']}])
        with self.assertRaises(ValueError):self.enqueue(mode='edit')
        a=self.app.upload('测试','source',image(),self.pid)
        with self.assertRaises(ValueError):self.enqueue(refs=[a['id']])
    def test_stdio_eof_preserves_process_standard_streams(self):
        import subprocess
        code="import sys;sys.path.insert(0,"+repr(str(Path(__file__).resolve().parents[1]))+");from studio_mcp import StudioMCP;s=StudioMCP('test');s.run(transport='stdio');assert not sys.stdout.closed;print('stdio preserved')"
        result=subprocess.run([sys.executable,'-c',code],input=b'',capture_output=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(result.stdout,b'stdio preserved\n');self.assertNotIn(b'Traceback',result.stderr)
    def test_http_authorization_and_origin_separation(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=self.app;threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
        def post(path,token=None,origin=None):
            headers={'Content-Type':'application/json'}
            if token:headers['X-Studio-Token']=token
            if origin:headers['Origin']=origin
            return urllib.request.urlopen(urllib.request.Request(url+path,data=b'{"tool":"studio_status"}',headers=headers))
        try:
            with self.assertRaises(urllib.error.HTTPError) as e:post('/api/agent/v1/call',origin=url)
            self.assertEqual(e.exception.code,401);e.exception.close()
            with post('/api/agent/v1/call',self.channel.secret.read_text()) as r:self.assertTrue(json.load(r)['enabled'])
            with self.assertRaises(urllib.error.HTTPError) as e:post('/api/shutdown',self.channel.secret.read_text())
            self.assertEqual(e.exception.code,403);e.exception.close()
        finally:server.shutdown();server.server_close()
    def test_submission_blocks_unread_reference(self):
        a=self.app.upload('衣服','outfit',image(),self.pid);self.enqueue(refs=[a['id']]);j=self.claim()
        with self.assertRaises(AgentError) as error:self.progress(j,'submitting')
        self.assertEqual(error.exception.code,'E_REFERENCE_REQUIRED');self.assertEqual(self.app.store.job(j['id'])['state'],'preparing')
    def test_submission_blocks_missing_reference_in_actual_arguments(self):
        a=self.app.upload('衣服','outfit',image(),self.pid);self.enqueue(refs=[a['id']]);j=self.claim()
        self.call('studio_reference',job_id=j['id'],claim_id=j['claim_id'],asset_id=a['id'])
        proof={'reference_uploads':[{'asset_id':a['id'],'platform_reference':'https://example.com/ref.png'}],'submission':{'tool':'generate_image','arguments':{'prompt':'test','ref_images':[]}}}
        with self.assertRaises(AgentError):self.progress(j,'submitting',**proof)
    def test_registration_rejects_missing_catalog_summary(self):
        with self.assertRaises(AgentError):self.channel.call('studio_register',{'session':self.session,'agent_name':'incomplete','models':MODELS})
    def test_registration_rejects_silent_catalog_truncation(self):
        with self.assertRaises(AgentError):self.call('studio_register',agent_name='incomplete',models=MODELS,catalog_summary={'discovered_count':24,'excluded':[]})
    def test_reference_submission_checks_and_preserves_audit(self):
        a=self.app.upload('衣服','outfit',image(),self.pid);self.enqueue(refs=[a['id']]);j=self.claim()
        args={'job_id':j['id'],'claim_id':j['claim_id']}
        self.call('studio_reference',**args,asset_id=a['id'])
        proof={'reference_uploads':[{'asset_id':a['id'],'platform_reference':'platform-image-1'}],'submission':{'tool':'generate_image','arguments':{'prompt':'test','ref_images':['platform-image-1']}}}
        self.progress(j,'submitting',**proof);self.call('studio_complete',**args,image_base64=image())
        audit=self.app.store.job(j['id'])['result']['submission_audit'];self.assertEqual(audit['reference_count'],1);self.assertNotIn('platform-image-1',json.dumps(audit))
    def test_reference_upload_order_must_match_job_order(self):
        a=self.app.upload('衣服','outfit',image(),self.pid);b=self.app.upload('鞋子','outfit',image(),self.pid);self.enqueue(refs=[a['id'],b['id']]);j=self.claim()
        for item in [a,b]:self.call('studio_reference',job_id=j['id'],claim_id=j['claim_id'],asset_id=item['id'])
        uploads=[{'asset_id':x['id'],'platform_reference':'platform-'+x['id']} for x in [a,b]]
        with self.assertRaises(AgentError):self.progress(j,'submitting',reference_uploads=uploads,submission={'tool':'generate','arguments':{'images':[u['platform_reference'] for u in reversed(uploads)]}})
    def test_reference_submission_does_not_accept_transport_credentials(self):
        a=self.app.upload('衣服','outfit',image(),self.pid);self.enqueue(refs=[a['id']]);j=self.claim();self.call('studio_reference',job_id=j['id'],claim_id=j['claim_id'],asset_id=a['id'])
        with self.assertRaises(AgentError):self.progress(j,'submitting',reference_uploads=[{'asset_id':a['id'],'platform_reference':'ref-1'}],submission={'tool':'generate','arguments':{'images':['ref-1'],'api_key':'dummy-test-only'}})
    def test_catalog_exclusions_are_visible_and_reconciled(self):
        self.call('studio_register',agent_name='full catalog',models=MODELS,catalog_summary={'discovered_count':2,'excluded':[{'name':'unsupported','reason':'平台不支持当前工作流'}]})
        info=self.call('studio_status');self.assertEqual(info['registered_model_count'],1);self.assertEqual(info['catalog_summary']['discovered_count'],2);self.assertEqual(len(info['catalog_summary']['excluded']),1)
if __name__=='__main__':unittest.main()
