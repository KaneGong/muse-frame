import sys,tempfile,unittest,io,json,time,urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from server import App
from features import ORIGINAL_CLIENT
from PIL import Image
class FeatureTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.app=App.__new__(App);self.app.store=Store(self.temp.name);self.app.init_features();self.s=self.app.store;self.p=self.s.put_project('A',{'refs':{},'draft':'original'});self.other=self.s.put_project('B',{'refs':{},'draft':'other'})
 def tearDown(self):self.s.db.close();self.temp.cleanup()
 def test_subject_scale_preset_roundtrip_does_not_apply_to_project(self):
  p=self.app.save_preset({'field':'scale','name':'小人物大环境','prompt':'人物可见高度约占画面40%–50%'})
  self.assertEqual(self.app.presets()[0]['field'],'scale')
  self.assertEqual(self.s.project(self.p['id'])['data']['draft'],'original')
  self.assertEqual(self.app.save_preset({**p,'archived':True})['archived'],True)
 def test_global_preset_persists_and_does_not_change_project(self):
  p=self.app.save_preset({'field':'style','name':'film','prompt':'自然日光\n细颗粒'});self.assertEqual(self.app.presets()[0]['prompt'],'自然日光 细颗粒');self.assertEqual(self.s.project(self.p['id'])['data']['draft'],'original');self.app.save_preset({**p,'archived':True});self.assertTrue(self.app.presets()[0]['archived']);p=self.app.presets()[0];self.app.save_preset({**p,'archived':False});self.assertFalse(self.app.presets()[0]['archived'])
 def test_preset_stale_edit_rejected(self):
  p=self.app.save_preset({'field':'gaze','name':'eyes','prompt':'看向远处'});self.app.save_preset({**p,'name':'updated'})
  with self.assertRaises(ValueError):self.app.save_preset({**p,'name':'stale'})
 def test_retouch_preset_is_structured_global_and_does_not_change_photo_or_prompt(self):
  p=self.app.save_preset({'field':'retouch','name':'柔暖人像','settings':{'exposure':.2,'highlights':-20,'texture':8}})
  self.assertEqual(p['engine_version'],2);self.assertEqual(len(p['settings']),10);self.assertEqual(p['settings']['texture'],8);self.assertEqual(self.s.project(self.p['id'])['data']['draft'],'original');self.assertEqual(self.s.assets(self.p['id']),[]);self.assertEqual(self.s.jobs(),[])
  self.assertEqual(self.app.presets()[0],p)
 def test_retouch_preset_rejects_missing_invalid_and_unknown_parameters(self):
  for extra in [{'settings':{}},{'settings':{'texture':100}},{'settings':{'unknown':1}},{'settings':{'exposure':True}},{'settings':{'exposure':.1},'engine_version':False}]:
   with self.assertRaises(ValueError):self.app.save_preset({'field':'retouch','name':'bad',**extra})
  self.assertEqual(self.app.presets(),[])
 def test_preset_categories_create_rename_and_reject_stale_edits(self):
  c=self.app.save_preset_category({'name':'日常人像'});p=self.app.save_preset({'field':'light','name':'窗光','prompt':'自然窗光','category_id':c['id']});renamed=self.app.save_preset_category({**c,'name':'自然人像'})
  self.assertEqual(renamed['id'],c['id']);self.assertEqual(self.app.presets()[0]['category_id'],c['id']);self.assertEqual(self.app.preset_categories()[0]['name'],'自然人像')
  with self.assertRaises(ValueError):self.app.save_preset_category({**c,'name':'旧修改'})
  with self.assertRaises(ValueError):self.app.save_preset_category({'name':'自然人像'})
  with self.assertRaises(ValueError):self.app.delete_preset_category(c)
  self.assertEqual(self.app.presets()[0],p)
 def test_deleting_category_keeps_active_and_trashed_presets_and_invalidates_stale_edit(self):
  c=self.app.save_preset_category({'name':'胶片'});a=self.app.save_preset({'field':'retouch','name':'暖色','category_id':c['id'],'settings':{'warmth':10}});b=self.app.save_preset({'field':'gaze','name':'视线','prompt':'看向镜头','category_id':c['id'],'archived':True})
  self.app.delete_preset_category(c);presets={p['id']:p for p in self.app.presets()};self.assertEqual(self.app.preset_categories(),[]);self.assertEqual(len(presets),2);self.assertEqual(presets[a['id']]['settings'],a['settings']);self.assertTrue(presets[b['id']]['archived']);self.assertTrue(all(p['category_id']=='' for p in presets.values()))
  with self.assertRaises(ValueError):self.app.save_preset(a)
 def test_retouch_delete_restore_keeps_recipe_and_category(self):
  c=self.app.save_preset_category({'name':'肖像'});p=self.app.save_preset({'field':'retouch','name':'柔和','category_id':c['id'],'settings':{'contrast':-10,'shadows':20}});deleted=self.app.save_preset({**p,'archived':True});restored=self.app.save_preset({**deleted,'archived':False});self.assertFalse(restored['archived']);self.assertEqual(restored['settings'],p['settings']);self.assertEqual(restored['category_id'],c['id'])
 def test_missing_category_or_missing_edited_preset_does_not_create_record(self):
  for data in [{'field':'style','name':'bad','prompt':'style','category_id':'missing'},{'id':'missing','field':'gaze','name':'bad','prompt':'look'}]:
   with self.assertRaises(ValueError):self.app.save_preset(data)
  self.assertEqual(self.app.presets(),[])
 def test_original_upload_no_network(self):
  a=self.s.put_asset({'id':'u','role':'face','name':'u','source':'uploaded','local':'assets/u.png'},self.p['id']);self.assertEqual(self.app.original(self.p['id'],'u')['id'],'u')
  with self.assertRaises(ValueError):self.app.original(self.other['id'],'u')
 def test_original_public_request_bytes_preserved(self):
  out=io.BytesIO();Image.new('RGB',(1024,1200),'white').save(out,format='PNG');raw=out.getvalue();self.s.put_asset({'id':'x','name':'x','url':'https://a.lovart.ai/a.png','original_size':[1024,1200]},self.p['id'])
  class Response(io.BytesIO):
   def __enter__(self):return self
   def __exit__(self,*a):self.close()
  class Opener:
   def open(inner,request,timeout):
    self.assertEqual(request.full_url,'https://a.lovart.ai/a.png');self.assertEqual(request.get_header('User-agent'),ORIGINAL_CLIENT);self.assertIsNone(request.get_header('Cookie'));self.assertIsNone(request.get_header('Authorization'));return Response(raw)
  with patch('features.urllib.request.build_opener',return_value=Opener()):a=self.app.original(self.p['id'],'x')
  self.assertTrue(a['original_saved']);self.assertIn('project_id=',a['original_url']);self.assertEqual((self.s.root/a['original_local']).read_bytes(),raw)
 def test_original_denied_no_bypass_and_no_repeated_fetch(self):
  self.s.put_asset({'id':'x','name':'x','url':'https://a.lovart.ai/a.png'},self.p['id'])
  with patch('features.urllib.request.build_opener') as op:
   op.return_value.open.side_effect=urllib.error.HTTPError('url',403,'Forbidden',{},None)
   for _ in range(2):
    with self.assertRaisesRegex(ValueError,'HTTP 403.*绘图平台'):self.app.original(self.p['id'],'x')
   self.assertEqual(op.return_value.open.call_count,1)
   with self.assertRaisesRegex(ValueError,'HTTP 403'):self.app.original(self.p['id'],'x',retry=True)
   self.assertEqual(op.return_value.open.call_count,2)
  self.assertFalse(self.s.asset('x',self.p['id']).get('original_saved',False))
 def test_old_client_failure_does_not_block_repaired_client(self):
  self.s.put_asset({'id':'x','name':'x','url':'https://a.lovart.ai/a.png','original_error':'old HTTP 403','original_attempt':time.time()},self.p['id'])
  with patch('features.urllib.request.build_opener') as op:
   op.return_value.open.side_effect=urllib.error.HTTPError('url',503,'Unavailable',{},None)
   with self.assertRaisesRegex(ValueError,'HTTP 503'):self.app.original(self.p['id'],'x')
   self.assertEqual(op.return_value.open.call_count,1)
 def test_attach_original_preserves_identity_and_bytes(self):
  self.s.put_asset({'id':'x','name':'generated','source':'generated','role':'output','original_size':[900,1000],'job_id':'original-job'},self.p['id'])
  out=io.BytesIO();Image.new('RGB',(1024,1200)).save(out,format='PNG');import base64
  result=self.app.attach_original(self.p['id'],'x',base64.b64encode(out.getvalue()).decode());self.assertEqual(result['id'],'x');self.assertEqual(result['job_id'],'original-job');self.assertTrue(result['original_saved']);self.assertEqual((self.s.root/result['original_local']).read_bytes(),out.getvalue())
  with self.assertRaises(ValueError):self.app.attach_original(self.other['id'],'x',base64.b64encode(out.getvalue()).decode())
 def test_edit_uses_hosted_original_url_and_exact_instruction(self):
  self.s.put_asset({'id':'output','name':'result','role':'output','url':'https://a.lovart.ai/original.png','local':'previews/small.jpg','preview_only':True},self.p['id'])
  payload={'mode':'edit','resultRole':'output','refs':['output'],'parent_asset':'output','model':'vertex/nano-banana-2-1','resolution':'2K','aspect_ratio':'3:4','prompt':'只改为自然浅笑，其余保留。'}
  job=self.s.enqueue('edit-original-contract',self.p['id'],payload)
  class Bridge:
   def call(self,name,args):self.last=(name,args);return {'structuredContent':{'task_ids':['existing-provider-task'],'project_id':'provider-project'}}
  self.app.bridge=Bridge();self.app.model_schema=lambda m:{'properties':{'resolution':{'enum':['1K','2K','4K']},'aspect_ratio':{'enum':['3:4','16:9']}}};self.app.submit(job);name,args=self.app.bridge.last;self.assertEqual(name,'edit_image');self.assertEqual(args['images'],['https://a.lovart.ai/original.png']);self.assertEqual(args['prompt'],payload['prompt']);self.assertEqual(args['params'],{'resolution':'2K','aspect_ratio':'3:4'});self.assertEqual(self.s.job(job['id'])['payload']['parent_asset'],'output')
 def test_analysis_only_own_pose_and_result_is_draft(self):
  (self.s.root/'assets/p.jpg').write_bytes(b'image');self.s.put_asset({'id':'pose','name':'pose','role':'pose','local':'assets/p.jpg'},self.p['id']);self.app.transcribe_pose=lambda path:json.dumps(__import__('test_pose_observation').sample())
  with self.assertRaises(ValueError):self.app.start_analysis(self.other['id'],'pose')
  task=self.app.start_analysis(self.p['id'],'pose')
  for _ in range(50):
   result=self.app.analysis(self.p['id'],task['id'])
   if result['state']!='running':break
   time.sleep(.01)
  self.assertEqual(result['state'],'completed');self.assertIn('侧坐',result['result']);self.assertEqual(self.s.project(self.p['id'])['data']['draft'],'original');self.assertEqual(self.s.jobs(),[])
  with self.assertRaises(ValueError):self.app.analysis(self.other['id'],task['id'])
 def test_project_asset_exposes_cached_thumbnail_urls(self):
  self.s.put_asset({'id':'t1','role':'output','name':'t','source':'generated','local':'previews/t1.png'},self.p['id'])
  got=self.s.asset('t1',self.p['id'])
  self.assertTrue(got['thumb'].startswith('/thumbs/previews/t1.png?project_id='))
  self.assertIn('w=360',got['thumb']);self.assertIn('w=1200',got['medium'])

if __name__=='__main__':unittest.main()
