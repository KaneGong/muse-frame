import sys,tempfile,unittest,sqlite3,json,threading,urllib.request,urllib.error,base64,io,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from server import App,Handler
from http.server import ThreadingHTTPServer
MODEL='vertex/nano-banana-2-1'
def png_fixture():
 from PIL import Image
 out=io.BytesIO();Image.new('RGB',(2,2),'white').save(out,'PNG');return out.getvalue()
class V2Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.s=Store(self.root)
  self.a=self.s.put_project('A',{'refs':{},'draft':'original'});self.b=self.s.put_project('B',{'refs':{},'draft':'other'})
  self.asset=self.s.put_asset({'id':'face','name':'face','role':'face','source':'uploaded'},self.a['id'])
  self.s.put_asset({'id':'outfit','name':'outfit','role':'outfit'},self.a['id'])
  self.app=App.__new__(App);self.app.store=self.s;self.app.status={'state':'connected'};self.app.execution_lock=threading.RLock();self.app.model_schema=lambda m:{'properties':{'aspect_ratio':{'enum':['3:4','16:9']},'resolution':{'enum':['2K']}}}
 def tearDown(self):self.s.db.close();self.tmp.cleanup()
 def payload(self):return {'prompt':'让图1穿图3，生成一张3:4竖幅人像摄影作品','ref_bindings':{'face':'face','outfit':'outfit'},'bodyFromFace':True,'mode':'generate','resultRole':'output','model':MODEL,'aspect_ratio':'3:4','resolution':'2K'}
 def test_display_thumbnails_use_ready_original_not_low_resolution_preview(self):
  self.s.put_asset({'id':'hires','role':'output','local':'previews/low.jpg','original_local':'assets/full.png'},self.a['id'])
  a=self.s.asset('hires',self.a['id'])
  self.assertTrue(a['medium'].startswith('/thumbs/assets/full.png?'))
  self.assertTrue(a['thumb'].startswith('/thumbs/assets/full.png?'))
  self.s.put_asset({**self.s._raw_asset('hires'),'photo_adjustment':{'local':'assets/adjusted.png','settings':{'exposure':1}}},self.a['id'])
  self.assertTrue(self.s.asset('hires',self.a['id'])['medium'].startswith('/thumbs/assets/adjusted.png?'))
 def test_replacing_local_original_invalidates_image_and_thumbnail_browser_urls(self):
  original=self.root/'assets/cache-original.png';original.write_bytes(b'old')
  self.s.put_asset({'id':'cache-photo','role':'output','original_local':'assets/cache-original.png'},self.a['id'])
  before=self.s.asset('cache-photo',self.a['id']);self.assertIn('&v=',before['original_url'])
  self.assertEqual(before['original_url'],self.s.asset('cache-photo',self.a['id'])['original_url'])
  original.write_bytes(b'new-full-original')
  after=self.s.asset('cache-photo',self.a['id'])
  self.assertNotEqual(before['original_url'],after['original_url'])
  self.assertNotEqual(before['thumb'],after['thumb']);self.assertNotEqual(before['medium'],after['medium'])
 def test_project_query_isolation(self):
  self.assertEqual(len(self.s.assets(self.a['id'])),2);self.assertEqual(self.s.assets(self.b['id']),[])
  with self.assertRaises(ValueError):self.s.asset('face',self.b['id'])
 def test_mutation_atomic_scope(self):
  with self.assertRaises(ValueError):self.s.asset_action(self.b['id'],['face'],{'favorite':True})
  self.assertFalse(self.s.asset('face',self.a['id'])['favorite'])
 def test_generation_scope(self):
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':self.b['id'],'request_key':'scope-test','payload':self.payload()})
 def test_reuse_metadata_independent(self):
  self.s.reuse(self.a['id'],self.b['id'],['face']);self.s.asset_action(self.b['id'],['face'],{'favorite':True,'trashed':True,'title':'B face'})
  self.assertFalse(self.s.asset('face',self.a['id'])['trashed']);self.assertEqual(self.s.asset('face',self.a['id'])['name'],'face')
 def test_role_order_body_fallback(self):
  j=self.app.enqueue({'project_id':self.a['id'],'request_key':'reference-map','payload':self.payload()});self.assertEqual(j['payload']['refs'],['face','face','outfit']);self.assertEqual(j['payload']['prompt'],self.payload()['prompt'])
 def test_scene_generation_needs_no_uploaded_references(self):
  p={'prompt':'设计海边步道的六机位无人环境参考板。','mode':'generate','resultRole':'scene','refs':[],'model':MODEL,'aspect_ratio':'16:9','resolution':'2K','title':'环境参考 · 海边步道'}
  j=self.app.enqueue({'project_id':self.a['id'],'request_key':'scene-no-ref','payload':p});self.assertEqual(j['payload']['refs'],[]);self.assertEqual(j['payload']['reference_snapshot'],[]);self.assertEqual(j['payload']['resultRole'],'scene');self.assertEqual(self.s.jobs(self.b['id']),[])
 def test_mismatched_role_rejected(self):
  p=self.payload();p['ref_bindings']['face']='outfit'
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':self.a['id'],'request_key':'bad-role-map','payload':p})
 def test_platform_cancel_singular_and_rejection_preserves_running(self):
  j=self.app.enqueue({'project_id':self.a['id'],'request_key':'cancel-platform','payload':self.payload()});self.s.update(j['id'],state='running',task_ids=['provider-task'])
  class Bridge:
   tools={'cancel_task':{}}
   def call(self,name,args):
    self.last=(name,args);return {'structuredContent':{'cancelled':False,'message':'already running'}}
  self.app.bridge=Bridge()
  with self.assertRaisesRegex(ValueError,'already running'):self.app.cancel(self.a['id'],j['id'])
  self.assertEqual(self.app.bridge.last,('cancel_task',{'task_id':'provider-task'}));self.assertEqual(self.s.job(j['id'])['state'],'running')
 def test_missing_body_not_shifted(self):
  p=self.payload();p['bodyFromFace']=False
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':self.a['id'],'request_key':'body-missing','payload':p})
 def test_unknown_ref_blocks_but_aspect_does_not(self):
  # 画幅只由模型参数决定，提示词不再携带比例，因此参数与文字不会再冲突。
  self.app.enqueue({'project_id':self.a['id'],'request_key':'aspect-only','payload':{**self.payload(),'aspect_ratio':'16:9'}})
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':self.a['id'],'request_key':'unknown-ref','payload':{**self.payload(),'prompt':'图4 环境，生成一张人像摄影作品'}})
 def test_idempotency(self):
  p={'project_id':self.a['id'],'request_key':'idempotent','payload':self.payload()};j=self.app.enqueue(p);self.assertEqual(j['id'],self.app.enqueue(p)['id']);self.assertEqual(len(self.s.jobs(self.a['id'])),1)
 def test_optimistic_save(self):
  self.s.put_project('A2',self.a['data'],self.a['id'],self.a['revision'])
  with self.assertRaises(ValueError):self.s.put_project('A3',self.a['data'],self.a['id'],self.a['revision'])
 def test_project_trash_restore_copy(self):
  self.s.project_action(self.a['id'],'trash');self.assertEqual(self.s.project(self.a['id'])['status'],'trashed');self.assertEqual(len(self.s.assets(self.a['id'])),2)
  with self.assertRaises(ValueError):self.s.put_project('A',self.a['data'],self.a['id'])
  self.s.project_action(self.a['id'],'restore');c=self.s.project_action(self.a['id'],'copy');self.s.asset_action(c['id'],['face'],{'title':'copy'});self.assertEqual(self.s.asset('face',self.a['id'])['name'],'face')
 def test_task_recovery_and_no_resubmit(self):
  j=self.app.enqueue({'project_id':self.a['id'],'request_key':'recover-key','payload':self.payload()});self.s.update(j['id'],state='submitting');self.s.recover();self.assertEqual(self.s.job(j['id'])['state'],'needs_review');self.assertIsNone(self.s.claim())
 def test_active_refs_protected_cancel(self):
  j=self.app.enqueue({'project_id':self.a['id'],'request_key':'active-key','payload':self.payload()})
  with self.assertRaises(ValueError):self.s.asset_action(self.a['id'],['face'],{'trashed':True})
  with self.assertRaises(ValueError):self.s.project_action(self.a['id'],'archive')
  self.app.cancel(self.a['id'],j['id']);self.assertEqual(self.s.job(j['id'])['state'],'cancelled')
 def test_edit_parent_is_scoped(self):
  p={**self.payload(),'mode':'edit','refs':['face'],'parent_asset':'outfit'};self.s.put_asset({'id':'alien','name':'alien'},self.b['id']);p['parent_asset']='alien'
  with self.assertRaises(ValueError):self.app.enqueue({'project_id':self.a['id'],'request_key':'parent-key','payload':p})
 def test_bundle_scope_and_quality(self):
  (self.root/'previews/a.jpg').write_bytes(b'preview');self.s.put_asset({'id':'image','name':'x','local':'previews/a.jpg','preview_only':True},self.a['id'])
  z=zipfile.ZipFile(io.BytesIO(self.app.bundle(self.a['id'],['image'])));self.assertIn('001-preview.jpg',z.namelist())
  with self.assertRaises(ValueError):self.app.bundle(self.b['id'],['image'])
 def test_http_scope(self):
  self.app.catalog=[];self.app.status={'state':'disconnected'};server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=self.app;threading.Thread(target=server.serve_forever,daemon=True).start();url='http://127.0.0.1:'+str(server.server_port)
  try:
   state=json.load(urllib.request.urlopen(url+'/api/state'));self.assertNotIn('assets',state)
   project=json.load(urllib.request.urlopen(url+'/api/project?id='+self.b['id']));self.assertEqual(project['assets'],[]);self.assertEqual(project['jobs'],[])
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(url+'/files/assets/x.jpg?project_id='+self.b['id'])
   error.exception.close()
   data=json.dumps({'project_id':self.b['id'],'ids':['face'],'changes':{'trashed':True}}).encode()
   req=urllib.request.Request(url+'/api/assets-action',data,headers={'Content-Type':'application/json','Origin':url})
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
   error.exception.close()
   self.assertFalse(self.s.asset('face',self.a['id'])['trashed'])
  finally:server.shutdown();server.server_close()
 def test_embedded_preview_and_version_survive_export(self):
  image='data:image/png;base64,'+base64.b64encode(png_fixture()).decode()
  self.s.put_asset({'id':'parent','role':'output','name':'parent','preview':image,'source':'generated','preview_only':True},self.a['id'])
  self.s.put_asset({'id':'child','role':'output','name':'child','preview':image,'source':'generated','preview_only':True,'parent_id':'parent'},self.a['id'])
  p=self.app.import_project(self.app.export_project(self.a['id']));assets=self.s.assets(p['id']);child=next(a for a in assets if a['name']=='child');parent=next(a for a in assets if a['name']=='parent');self.assertEqual(child['parent_id'],parent['id']);self.assertTrue((self.root/child['local']).exists())
 def test_export_import_preserves_scope(self):
  self.s.put_asset({'id':'local','name':'local','role':'face','local':'assets/local.png','source':'uploaded'},self.a['id']);(self.root/'assets/local.png').write_bytes(png_fixture())
  d=self.a['data'];d['refs']={'face':'local'};self.s.put_project('A',d,self.a['id']);export=self.app.export_project(self.a['id']);p=self.app.import_project(export)
  self.assertNotEqual(p['data']['refs']['face'],'local');self.assertEqual(len(self.s.jobs(p['id'])),0);self.assertTrue(self.s.asset(p['data']['refs']['face'],p['id']))
 def test_existing_gallery_pose_can_be_saved_to_personal_library_once_offline(self):
  self.app.init_features()
  path=self.root/'assets/pose.png';path.write_bytes(png_fixture())
  self.s.put_asset({'id':'pose-one','name':'pose','role':'pose','local':'assets/pose.png','gallery_id':'P001-side','gallery_meta':{'name':'坐姿','angle':'侧面','cat':'坐姿'}},self.a['id'])
  def no_network():raise AssertionError('existing reference should work offline')
  self.app.pose_gallery=no_network
  self.app.import_gallery_pose(self.a['id'],'P001-side',True)
  self.app.import_gallery_pose(self.a['id'],'P001-side',True)
  saved=[p for p in self.app.presets() if p.get('gallery_pose_id')=='P001-side']
  self.assertEqual(len(saved),1);self.assertEqual(saved[0]['name'],'坐姿 · 侧面');self.assertTrue(saved[0]['image'])
  self.assertEqual(len([a for a in self.s.assets(self.a['id']) if a.get('gallery_id')=='P001-side']),1)
 def test_export_import_retains_reference_library_provenance(self):
  for aid,role,extra in [('costume','outfit',{'costume_id':'C001','costume_meta':{'source':'COSTUME-DB-01'}}),('pose','pose',{'gallery_id':'pose_front','gallery_meta':{'source':'catalog'}}),('face_ref','face',{'face_gallery_id':'F001','face_gallery_source':'https://ai-portrait-gallery.pages.dev/'})]:
   path='assets/'+aid+'.png';(self.root/path).write_bytes(png_fixture());self.s.put_asset({'id':aid,'name':aid,'role':role,'local':path,'source':'uploaded',**extra},self.a['id'])
  p=self.app.import_project(self.app.export_project(self.a['id']));assets={a['name']:a for a in self.s.assets(p['id'])}
  self.assertEqual(assets['costume']['costume_id'],'C001');self.assertEqual(assets['costume']['costume_meta']['source'],'COSTUME-DB-01');self.assertEqual(assets['pose']['gallery_id'],'pose_front');self.assertEqual(assets['pose']['gallery_meta']['source'],'catalog');self.assertEqual(assets['face_ref']['face_gallery_id'],'F001');self.assertEqual(assets['face_ref']['face_gallery_source'],'https://ai-portrait-gallery.pages.dev/')
class MigrationTests(unittest.TestCase):
 def test_legacy_migration_idempotent(self):
  with tempfile.TemporaryDirectory() as root:
   s=Store(root);s.db.execute('delete from migrations');p=s.put_project('legacy',{'refs':{'face':'a'},'draft':'my exact prompt'}) if False else s.put_project('legacy',{'refs':{},'draft':'my exact prompt'})
   s.put_asset({'id':'a','name':'a','role':'face'});s.put_asset({'id':'orphan','name':'orphan','role':'source'});s.db.execute('update projects set data=? where id=?',(json.dumps({'refs':{'face':'a'},'draft':'my exact prompt'}),p['id']));s.db.commit();s.db.close()
   s=Store(root);self.assertEqual(s.project(p['id'])['data']['draft'],'my exact prompt');self.assertEqual([a['id'] for a in s.assets(p['id'])],['a']);self.assertEqual(s.project('migration-unassigned')['status'],'archived');s.db.close();s=Store(root);self.assertEqual(len(s.assets(p['id'])),1);s.db.close()
if __name__=='__main__':unittest.main()
