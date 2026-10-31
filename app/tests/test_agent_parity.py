"""Migration parity: real isolated Store/HTTP, no platform side effects."""
import unittest,tempfile,json,io,base64,threading,urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer
import test_agent_channel as support
from agent_channel import AgentError
from server import Handler
from PIL import Image

class ParityTests(unittest.TestCase):
    setUp=support.AgentTests.setUp;tearDown=support.AgentTests.tearDown
    call=support.AgentTests.call;enqueue=support.AgentTests.enqueue;claim=support.AgentTests.claim;progress=support.AgentTests.progress
    def post(self,path,payload):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=self.app
        threading.Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
        try:
            req=urllib.request.Request(origin+path,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':origin})
            with urllib.request.urlopen(req) as r:return json.load(r)
        finally:server.shutdown();server.server_close()
    def review(self):
        self.enqueue();j=self.claim();self.progress(j,'needs_review',message='核对已有提交，不重生成');return j
    def test_same_executor_reconnect_preserves_recovery_but_blocks_competitor(self):
        self.call('studio_register',agent_name='stable',models=support.MODELS,executor_instance_id='process-instance-123')
        self.enqueue();job=self.claim();self.progress(job,'submitting');self.progress(job,'running',task_ids=['existing'])
        payload={'session':'reconnected-session','agent_name':'stable','models':support.MODELS,'catalog_summary':{'discovered_count':1,'excluded':[]},'executor_instance_id':'process-instance-123'}
        self.channel.call('studio_register',payload)
        self.assertEqual(self.app.store.job(job['id'])['state'],'needs_review')
        with self.assertRaises(AgentError):self.channel.call('studio_register',{**payload,'session':'competitor-session','executor_instance_id':'different-process'})

    def test_same_platform_authorizes_second_project_without_losing_old_job(self):
        old=self.review();binding=self.channel.settings['binding_id']
        self.channel.configure({'enabled':True,'project_id':self.other,'platform':'模拟平台（不调用真实服务）'})
        self.assertEqual(self.channel.settings['binding_id'],binding)
        self.assertEqual(set(self.channel.info()['authorized_project_ids']),{self.pid,self.other})
        self.call('studio_register',agent_name='SDK模拟执行器',models=support.MODELS)
        self.assertIn(old['id'],[j['id'] for j in self.call('studio_recovery')['jobs']])
        pid=self.pid;self.pid=self.other
        try:self.enqueue();new=self.claim();self.assertEqual(new['project_id'],self.other)
        finally:self.pid=pid
    def test_platform_switch_keeps_old_binding_for_explicit_return(self):
        old=self.review();binding=self.channel.settings['binding_id']
        self.channel.configure({'enabled':True,'project_id':self.pid,'platform':'Another platform'})
        self.call('studio_register',agent_name='SDK模拟执行器',models=support.MODELS)
        self.assertEqual(self.call('studio_recovery')['jobs'],[])
        self.channel.configure({'enabled':True,'project_id':self.pid,'platform':'模拟平台（不调用真实服务）'})
        self.call('studio_register',agent_name='SDK模拟执行器',models=support.MODELS)
        self.assertEqual(self.channel.settings['binding_id'],binding)
        self.assertEqual(self.call('studio_recovery')['jobs'][0]['id'],old['id'])
    def test_link_existing_external_task_remains_recoverable(self):
        old=self.review();self.post('/api/link-task',{'project_id':self.pid,'id':old['id'],'task_id':'existing-platform-task'})
        row=self.app.store.job(old['id']);self.assertEqual(row['state'],'needs_review')
        resumed=self.call('studio_resume',job_id=old['id'])['job'];self.progress(resumed,'running',task_ids=row['task_ids'])
        done=self.call('studio_complete',job_id=old['id'],claim_id=resumed['claim_id'],image_base64=support.image())
        self.assertEqual(self.app.store.asset(done['asset_id'],self.pid)['project_id'],self.pid)
    def test_running_cancel_requires_provider_confirmation(self):
        self.enqueue();j=self.claim();self.progress(j,'submitting');self.progress(j,'running',task_ids=['provider-one'])
        self.app.cancel(self.pid,j['id'])
        status=self.call('studio_job',job_id=j['id'],claim_id=j['claim_id'])['job'];self.assertTrue(status['cancel_requested'])
        with self.assertRaises(AgentError):self.progress(j,'cancelled')
        self.progress(j,'cancelled',cancellation_confirmed=True);self.assertEqual(self.app.store.job(j['id'])['state'],'cancelled')
    def test_cancel_before_submit_never_allows_submitting(self):
        self.enqueue();j=self.claim();self.app.cancel(self.pid,j['id'])
        with self.assertRaises(AgentError):self.progress(j,'submitting')
        self.assertEqual(self.app.store.job(j['id'])['state'],'cancelled')
    def test_user_can_close_verified_review_without_new_generation(self):
        old=self.review();self.post('/api/close-review',{'project_id':self.pid,'id':old['id'],'confirmed':True,'expected_updated':self.app.store.job(old['id'])['updated']})
        self.assertEqual(self.app.store.job(old['id'])['state'],'cancelled')
        self.assertEqual(self.call('studio_recovery')['jobs'],[])
    def test_large_local_original_import_and_metadata(self):
        p=self.root/'large.png';Image.new('RGB',(2500,2500),'beige').save(p,compress_level=0);self.assertGreater(p.stat().st_size,16*1024*1024)
        self.enqueue();j=self.claim();self.progress(j,'submitting');self.progress(j,'running',task_ids=['provider-large'],platform_result={'project_id':'platform-project','edit_url':'https://www.lovart.ai/project/a','url':'https://artifacts.lovart.ai/large.png'})
        r=self.call('studio_complete',job_id=j['id'],claim_id=j['claim_id'],local_path=str(p))
        a=self.app.store.asset(r['asset_id'],self.pid);self.assertEqual(a['original_size'],[2500,2500]);self.assertEqual((self.root/a['original_local']).read_bytes(),p.read_bytes())
        self.assertEqual(a['edit_url'],'https://www.lovart.ai/project/a');self.assertEqual(self.app.store.job(j['id'])['result']['project_id'],'platform-project')
    def test_synchronous_result_is_recoverable_without_task_id(self):
        self.enqueue();j=self.claim();self.progress(j,'submitting')
        self.progress(j,'result_ready',platform_result={'url':'https://artifacts.lovart.ai/sync.png','project_id':'sync-project'})
        self.assertEqual(self.call('studio_recovery')['jobs'][0]['result']['url'],'https://artifacts.lovart.ai/sync.png')
        self.call('studio_complete',job_id=j['id'],claim_id=j['claim_id'],image_base64=support.image());self.assertEqual(self.app.store.job(j['id'])['state'],'completed')
    def test_invalid_original_and_result_links_are_rejected(self):
        self.enqueue();j=self.claim();self.progress(j,'submitting');p=self.root/'not-image.txt';p.write_text('not an image')
        with self.assertRaises(ValueError):self.call('studio_complete',job_id=j['id'],claim_id=j['claim_id'],local_path=str(p))
        with self.assertRaises(ValueError):self.progress(j,'result_ready',platform_result={'url':'file:///etc/passwd'})
    def test_pose_analysis_is_claimed_scoped_and_fills_result(self):
        self.call('studio_register',agent_name='vision agent',models=support.MODELS,executor_capabilities=['pose_analysis'])
        a=self.app.upload('姿态','pose',support.image(),self.pid);analysis=self.app.start_analysis(self.pid,a['id'])
        claimed=self.call('studio_analysis_claim')['analysis'];self.assertEqual(claimed['id'],analysis['id'])
        args={'analysis_id':analysis['id'],'claim_id':claimed['claim_id']}
        ref=self.call('studio_analysis_reference',**args);self.assertEqual(ref['base64'],support.image())
        self.call('studio_analysis_complete',**args,text='身体面向镜头，右手放在椅背，双脚落地；左手被遮挡，无法确认。')
        self.assertEqual(self.app.analysis(self.pid,analysis['id'])['state'],'completed')
        with self.assertRaises(ValueError):self.app.start_analysis(self.other,a['id'])
    def test_missing_vision_capability_gives_actionable_message(self):
        a=self.app.upload('姿态','pose',support.image(),self.pid)
        with self.assertRaisesRegex(ValueError,'视觉能力'):self.app.start_analysis(self.pid,a['id'])
if __name__=='__main__':unittest.main()
