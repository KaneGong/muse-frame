import base64,io,json,tempfile,threading,unittest,sys
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store

def image_bytes(size=(32,48)):
 b=io.BytesIO();Image.new('RGB',size,'#667766').save(b,'PNG');return b.getvalue()

class StabilityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name);self.p=self.s.put_project('测试',{'refs':{},'draft':'test','customPoses':[]});self.app=App.__new__(App);self.app.store=self.s;self.app.status={'state':'connected'};self.app.execution_lock=threading.RLock()
 def tearDown(self):self.s.db.close();self.tmp.cleanup()
 def upload(self):return self.app.upload('valid.png','output',base64.b64encode(image_bytes()).decode(),self.p['id'])
 def test_export_import_keeps_original_bytes_and_preview_separate(self):
  a=self.upload();original=image_bytes((64,96));rel='assets/original.png';(self.s.root/rel).write_bytes(original);raw=self.s.asset(a['id']);raw.update(source='generated',preview_only=True,original_local=rel,original_size=[64,96],original_saved=True);self.s.put_asset(raw)
  restored=self.app.import_project(self.app.export_project(self.p['id']));b=self.s.assets(restored['id'])[0]
  self.assertTrue(b.get('original_local'),'export lost original');self.assertEqual((self.s.root/b['original_local']).read_bytes(),original);self.assertNotEqual(b['local'],b['original_local']);self.assertTrue(b['preview_only'])
 def test_malformed_import_creates_no_partial_project(self):
  package={'version':2,'project':{'name':'bad','data':{'refs':{}}},'assets':[{'id':'ok','name':'one','role':'face','file_base64':base64.b64encode(image_bytes()).decode()},{'id':'bad','role':'outfit','file_base64':'broken'}]};before=len(self.s.projects())
  with self.assertRaises(ValueError):self.app.import_project(package)
  self.assertEqual(len(self.s.projects()),before);self.assertEqual(len(list((self.s.root/'assets').iterdir())),0)
 def test_corrupt_image_is_rejected_before_file_or_asset_write(self):
  jpeg=io.BytesIO();Image.new('RGB',(32,48),'green').save(jpeg,'JPEG')
  for raw in [b'\x89PNG\r\n\x1a\nnot-image',jpeg.getvalue()[:-20]]:
   with self.subTest(length=len(raw)):
    with self.assertRaises(ValueError):self.app.upload('fake-image','face',base64.b64encode(raw).decode(),self.p['id'])
    self.assertEqual(self.s.assets(self.p['id']),[]);self.assertEqual(len(list((self.s.root/'assets').iterdir())),0)
 def test_completed_platform_job_with_no_artifacts_is_not_marked_success(self):
  j=self.s.enqueue('missing-results',self.p['id'],{'prompt':'test','mode':'generate','resultRole':'scene','refs':[],'resolution':'2K'});self.s.update(j['id'],state='running',task_ids=['existing-platform-task'])
  class Bridge:
   def call(self,name,args):return {'structuredContent':{'status':'completed','artifacts':[]},'content':[]}
  self.app.bridge=Bridge();self.app.poll(self.s.job(j['id']));after=self.s.job(j['id']);self.assertEqual(after['state'],'needs_review');self.assertEqual(after['task_ids'],['existing-platform-task']);self.assertTrue(after['error'])
 def test_import_rolls_back_db_and_new_files_on_late_failure(self):
  a=self.upload();package=self.app.export_project(self.p['id']);package['assets'][0]['favorite']='invalid boolean'
  before=[x['id'] for x in self.s.projects()];files={str(x) for x in (self.s.root/'assets').iterdir()}
  with self.assertRaises(ValueError):self.app.import_project(package)
  self.assertEqual([x['id'] for x in self.s.projects()],before);self.assertEqual({str(x) for x in (self.s.root/'assets').iterdir()},files)
 def test_recheck_recovers_existing_task_without_another_generation(self):
  j=self.s.enqueue('recover-outputs',self.p['id'],{'prompt':'test','mode':'generate','resultRole':'scene','refs':[],'resolution':'2K'});self.s.update(j['id'],state='needs_review',task_ids=['existing-platform-task'])
  class Bridge:
   def call(inner,name,args):
    if name=='get_credits':return {'structuredContent':{'credits':1}}
    if name not in ['get_task_status','get_task']:raise AssertionError('unexpected generation')
    return {'structuredContent':{'status':'completed','artifacts':[{'url':'https://a.lovart.ai/test.png','width':32,'height':48}]},'content':[{'type':'image','mimeType':'image/png','data':base64.b64encode(image_bytes()).decode()}]}
  self.app.bridge=Bridge();after=self.app.recheck(self.p['id'],j['id']);self.assertEqual(after['state'],'completed');self.assertEqual(len(after['result']['asset_ids']),1);self.assertEqual(len(self.s.jobs(self.p['id'])),1)
 def test_archived_project_cannot_attach_original(self):
  a=self.upload();self.s.project_action(self.p['id'],'archive')
  with self.assertRaises(ValueError):self.app.attach_original(self.p['id'],a['id'],base64.b64encode(image_bytes()).decode())
if __name__=='__main__':unittest.main()
