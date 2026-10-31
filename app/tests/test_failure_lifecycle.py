import unittest,time
import test_agent_channel as support
from agent_lifecycle import result_metadata,AgentError
class FailureLifecycleTests(unittest.TestCase):
 setUp=support.AgentTests.setUp;tearDown=support.AgentTests.tearDown
 call=support.AgentTests.call;enqueue=support.AgentTests.enqueue;claim=support.AgentTests.claim;progress=support.AgentTests.progress
 def test_structured_provider_failure_is_retained_and_not_recovered(self):
  self.enqueue();j=self.claim();self.progress(j,'submitting');self.progress(j,'running',task_ids=['provider-id'])
  self.progress(j,'failed',task_ids=['provider-id'],platform_result={'result_ready':False,'source':'Lovart','error':{'code':'API_CONTENT_POLICY','message':'Image filtered by provider'}})
  job=self.app.store.job(j['id']);self.assertEqual(job['result']['error']['code'],'API_CONTENT_POLICY');self.assertIn('API_CONTENT_POLICY',job['error']);self.assertEqual(self.call('studio_recovery')['jobs'],[])
 def test_error_strings_are_bounded_and_credential_fragments_redacted(self):
  m=result_metadata({'error':{'code':'PROVIDER_ERROR','message':'Bearer secret-material token=private '+('x'*4000),'unknown':'not stored'}})
  self.assertNotIn('secret-material',m['error']['message']);self.assertNotIn('private',m['error']['message']);self.assertLessEqual(len(m['error']['message']),3000);self.assertNotIn('unknown',m['error'])
 def test_old_session_receives_specific_replaced_signal_and_cannot_take_back(self):
  old=self.session;self.call('studio_register',agent_name='Hermes',models=support.MODELS,executor_instance_id='same-process')
  self.session='new-session-123';self.call('studio_register',agent_name='Hermes',models=support.MODELS,executor_instance_id='same-process')
  for tool,args in [('studio_heartbeat',{}),('studio_register',{'models':support.MODELS,'catalog_summary':{'discovered_count':1,'excluded':[]},'executor_instance_id':'same-process'})]:
   with self.assertRaises(AgentError) as raised:self.channel.call(tool,{'session':old,**args})
   self.assertEqual(raised.exception.code,'E_SESSION_REPLACED')
 def test_archiving_keeps_terminal_history_and_rejects_active(self):
  self.enqueue();j=self.claim()
  with self.assertRaises(ValueError):self.app.archive_job(self.pid,j['id'],True)
  self.progress(j,'failed',message='Platform refused')
  self.app.archive_job(self.pid,j['id'],True);self.assertTrue(self.app.store.job(j['id'])['archived']);self.assertEqual(self.app.store.job(j['id'])['state'],'failed')
  self.app.archive_job(self.pid,j['id'],False);self.assertFalse(self.app.store.job(j['id'])['archived'])
 def pose(self):
  image=self.app.upload('synthetic','pose',support.image(),self.pid)
  self.call('studio_register',agent_name='Hermes',models=support.MODELS,executor_capabilities=['pose_analysis']);return image
 def test_analysis_claim_retries_return_same_claim_and_history_can_restore_result(self):
  image=self.pose();a=self.app.start_analysis(self.pid,image['id']);first=self.call('studio_analysis_claim')['analysis'];second=self.call('studio_analysis_claim')['analysis'];self.assertEqual(first['claim_id'],second['claim_id'])
  ids={'analysis_id':a['id'],'claim_id':first['claim_id']};self.call('studio_analysis_reference',**ids);self.call('studio_analysis_complete',**ids,text='画面左侧手臂轻触椅背。')
  rows=self.app.analysis_results(self.pid);self.assertEqual(rows[0]['result'],'画面左侧手臂轻触椅背。');self.assertEqual(rows[0]['asset_id'],image['id'])
 def test_stuck_pose_analysis_is_reported_not_left_running_forever(self):
  image=self.pose();a=self.app.start_analysis(self.pid,image['id']);self.app.store.db.execute('update analyses set updated=? where id=?',(time.time()-400,a['id']));self.app.store.db.commit()
  self.channel.expire_analyses();self.assertEqual(self.app.analysis(self.pid,a['id'])['state'],'failed');self.assertIn('超时',self.app.analysis(self.pid,a['id'])['error'])
 def test_user_retry_is_a_new_job_and_uncertain_submissions_cannot_be_retried(self):
  self.enqueue();old=self.claim();payload=dict(old['payload'],retry_of=old['id'])
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':self.pid,'request_key':'uncertain-retry','payload':payload})
  self.progress(old,'failed',message='Provider refused')
  new=self.app.enqueue({'project_id':self.pid,'request_key':'user-confirmed-retry','payload':payload})
  self.assertNotEqual(new['id'],old['id']);self.assertEqual(new['payload']['retry_of'],old['id']);self.assertEqual(self.app.store.job(old['id'])['state'],'failed')

 def test_structured_pose_roundtrip_retains_unknown_and_model(self):
  from test_pose_observation import sample
  image=self.pose();a=self.app.start_analysis(self.pid,image['id']);claim=self.call('studio_analysis_claim')['analysis'];self.assertEqual(claim['result_format'],'pose_observation_v1')
  ids={'analysis_id':a['id'],'claim_id':claim['claim_id']};self.call('studio_analysis_reference',**ids);self.call('studio_analysis_complete',**ids,observation=sample(),vision_model='test-vision')
  saved=self.app.analysis(self.pid,a['id']);self.assertEqual(saved['state'],'completed');self.assertEqual(saved['observation']['vision_model'],'test-vision');self.assertEqual(saved['observation']['observations']['leg_front']['contact']['state'],'unknown');self.assertEqual(saved['result'],sample()['summary'])
 def test_structured_pose_requires_image_read_and_rejects_incomplete_observation(self):
  from test_pose_observation import sample
  image=self.pose();a=self.app.start_analysis(self.pid,image['id']);claim=self.call('studio_analysis_claim')['analysis'];ids={'analysis_id':a['id'],'claim_id':claim['claim_id']}
  with self.assertRaises(AgentError):self.call('studio_analysis_complete',**ids,observation=sample())
  self.call('studio_analysis_reference',**ids)
  with self.assertRaises(AgentError):self.call('studio_analysis_complete',**ids,observation={'summary':'empty'})
 def test_legacy_pose_completion_is_explicitly_labeled(self):
  image=self.pose();a=self.app.start_analysis(self.pid,image['id']);claim=self.call('studio_analysis_claim')['analysis'];ids={'analysis_id':a['id'],'claim_id':claim['claim_id']};self.call('studio_analysis_reference',**ids);self.call('studio_analysis_complete',**ids,text='侧坐。')
  self.assertEqual(self.app.analysis(self.pid,a['id'])['observation']['format'],'legacy_text')
