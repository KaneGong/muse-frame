import sys,tempfile,unittest,threading,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store

class PromptContractTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.store=Store(self.tmp.name);self.addCleanup(self.store.db.close)
  self.pid=self.store.put_project('isolated',{})['id']
  for aid,role in [('f','face'),('b','body'),('o','outfit'),('p','pose')]:self.store.put_asset({'id':aid,'role':role,'name':aid},self.pid)
  self.app=App.__new__(App);self.app.store=self.store;self.app.execution_lock=threading.RLock()
  self.app.model_schema=lambda m:{'properties':{'aspect_ratio':{'enum':['3:4']},'resolution':{'enum':['1K']}}}
 def payload(self,mode='manual'):
  roles={'face':'f','body':'b','outfit':'o','scene':'','pose':'p'}
  return {'mode':'generate','resultRole':'output','model':'fixture','aspect_ratio':'3:4','resolution':'1K','ref_bindings':roles,'prompt':'Use image 1 for identity, image 2 for body, image 3 for wardrobe and image 4 for pose. One continuous photo.',
   'prompt_contract':{'version':2,'compiler':'shot-spec-v2.1','mode':mode,'shot_id':'s1','reference_roles':roles,'snapshot':{'mode':mode,'fields':{},'sources':{},'pose':{'source':'reference','assetId':'p','text':'','adherence':'natural'},'goal':'','notes':[]}}}
 def enqueue(self,payload):return self.app.enqueue({'project_id':self.pid,'request_key':'test-request-'+str(len(self.store.jobs(self.pid))),'payload':payload})
 def test_manual_multireference_prompt_does_not_require_chinese_pose_heading(self):
  p=self.payload();j=self.enqueue(p);self.assertEqual(j['payload']['prompt'],p['prompt']);self.assertEqual(j['payload']['refs'],['f','b','o','p'])
  self.assertEqual(j['payload']['prompt_contract']['prompt_sha256'],hashlib.sha256(p['prompt'].encode()).hexdigest())
 def test_manual_text_is_not_compacted_or_rewritten(self):
  p=self.payload();p['prompt']='My notes:\n\n\nOne portrait.';self.assertEqual(self.enqueue(p)['payload']['prompt'],p['prompt'])
 def test_new_compiler_and_previous_snapshot_remain_accepted(self):
  for compiler in ['shot-spec-v2.1','shot-spec-v2.2','shot-spec-v2.3','shot-spec-v2.4','shot-spec-v2.5','shot-spec-v2.6','shot-spec-v2.7']:
   p=self.payload();p['prompt_contract']['compiler']=compiler
   self.assertEqual(self.enqueue(p)['payload']['prompt_contract']['compiler'],compiler)
 def test_unknown_contract_cannot_silently_downgrade(self):
  for field,value in [('version',3),('compiler','future-compiler'),('mode','unknown')]:
   p=self.payload();p['prompt']='姿态参考：图4提供动作。';p['prompt_contract'][field]=value
   with self.assertRaises(ValueError):self.enqueue(p)
 def test_contract_cannot_claim_another_pose_image_or_snapshot(self):
  for mutate in [lambda p:p['prompt_contract'].update(reference_roles={'face':'f','body':'b','outfit':'o','scene':'','pose':'elsewhere'}),lambda p:p['prompt_contract']['snapshot']['pose'].update(assetId='elsewhere')]:
   p=self.payload();p['prompt']='姿态参考：图4提供动作。';mutate(p)
   with self.assertRaises(ValueError):self.enqueue(p)
 def test_english_number_above_actual_reference_count_is_rejected(self):
  p=self.payload();p['prompt']='姿态参考：图4提供动作。 Use image 5 for pose.'
  with self.assertRaises(ValueError):self.enqueue(p)
 def test_legacy_pose_guard_and_cross_project_isolation_remain(self):
  p=self.payload();p.pop('prompt_contract')
  with self.assertRaises(ValueError):self.enqueue(p)
  p=self.payload();pid2=self.store.put_project('other',{})['id']
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':pid2,'request_key':'other','payload':p})
