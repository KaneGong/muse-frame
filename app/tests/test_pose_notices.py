import sys,tempfile,unittest,threading
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from server import App
class PoseNoticeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name);self.p=self.s.put_project('A',{'refs':{}});self.other=self.s.put_project('B',{'refs':{}});self.app=App.__new__(App);self.app.store=self.s;self.app.status={'state':'connected'};self.app.model_schema=lambda m:{'properties':{}};self.app.init_features();self.app.play_sound=Mock(return_value=True)
 def tearDown(self):self.s.db.close();self.tmp.cleanup()
 def payload(self):return {'prompt':'姿态示意','mode':'generate','resultRole':'pose','refs':[],'model':'fixture','resolution':'2K','aspect_ratio':'3:4','batch_id':'one-batch','pose_spec':{'name':'侧坐','prompt':'侧坐，手撑台面。','category':'A'}}
 def job(self,key='pose-task-one'):
  return self.app.enqueue({'project_id':self.p['id'],'request_key':key,'payload':self.payload()})
 def test_batch_sound_once_and_readable_completion(self):
  j1=self.job();j2=self.job('pose-task-two');self.s.update(j1['id'],state='completed');self.app.play_sound.assert_not_called();self.assertEqual(self.app.task_summary()['projects'][0]['active'],1)
  self.s.update(j2['id'],state='completed');self.app.play_sound.assert_called_once();self.s.update(j2['id'],state='completed');self.app.play_sound.assert_called_once();self.assertEqual(self.app.task_summary()['projects'][0]['completed'],2);self.app.read_notices(self.p['id']);self.assertEqual(self.app.task_summary()['projects'],[])
 def test_restart_and_muting_no_duplicate_sounds(self):
  self.app.set_sound(False);j=self.job();self.s.update(j['id'],state='completed');self.app.play_sound.assert_not_called();self.app.init_features();self.assertFalse(self.app.sound_enabled());self.assertEqual(self.app.task_summary()['projects'][0]['completed'],1);self.app.play_sound.assert_not_called()
 def test_notice_ack_is_project_scoped(self):
  j=self.job();self.s.update(j['id'],state='failed');self.app.read_notices(self.other['id']);self.assertEqual(self.app.task_summary()['projects'][0]['attention'],1)
 def test_pose_generation_capture_keeps_editable_spec(self):
  j=self.job();meta=self.app.capture(j,{'content':[]},{'artifacts':[{'url':'https://a.lovart.ai/pose.png'}]});a=self.s.asset(meta['asset_ids'][0],self.p['id']);self.assertEqual(a['role'],'pose');self.assertEqual(a['pose_spec'],j['payload']['pose_spec']);self.assertNotIn('customPoses',self.s.project(self.p['id'])['data'])
 def test_final_pose_roles_and_numbering(self):
  for role in ['face','outfit','scene','pose']:self.s.put_asset({'id':role,'name':role,'role':role},self.p['id'])
  p={'prompt':'参考图1，图2，图3。\n姿态参考：参考图4的动作。','mode':'generate','resultRole':'output','ref_bindings':{'face':'face','outfit':'outfit','pose':'pose'},'bodyFromFace':True,'model':'fixture','resolution':'2K','aspect_ratio':'3:4'}
  j=self.app.enqueue({'project_id':self.p['id'],'request_key':'final-four-refs','payload':p});self.assertEqual(j['payload']['refs'],['face','face','outfit','pose'])
  p['ref_bindings']['scene']='scene'
  with self.assertRaisesRegex(ValueError,'姿态参考'):self.app.enqueue({'project_id':self.p['id'],'request_key':'bad-five-refs','payload':p})
  p['prompt']=p['prompt'].replace('图4','图5');j=self.app.enqueue({'project_id':self.p['id'],'request_key':'final-five-refs','payload':p});self.assertEqual(j['payload']['refs'],['face','face','outfit','scene','pose'])
 def test_old_pose_only_prompt_cannot_misuse_pose_as_scene(self):
  for role in ['face','outfit','pose']:self.s.put_asset({'id':role,'name':role,'role':role},self.p['id'])
  p={'prompt':'姿态参考：人物姿态依照图4；支撑物本身取自图4环境中已有的物件，不照搬线稿里的示意物。','mode':'generate','resultRole':'output','ref_bindings':{'face':'face','outfit':'outfit','pose':'pose'},'bodyFromFace':True,'model':'fixture','resolution':'2K','aspect_ratio':'3:4'}
  with self.assertRaisesRegex(ValueError,'误写成环境图'):self.app.enqueue({'project_id':self.p['id'],'request_key':'old-pose-only','payload':p})
 def test_review_remains_visible_after_notifications_are_read(self):
  j=self.job();self.s.update(j['id'],state='needs_review');self.app.read_notices(self.p['id'])
  entry=self.app.task_summary()['projects'][0];self.assertEqual(entry['review'],1)
if __name__=='__main__':unittest.main()
