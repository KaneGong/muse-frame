import sys,unittest,tempfile,hashlib,json,io,zipfile,base64
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App,Handler
from store import Store
from retouch import render
class AdjustmentTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.app=App.__new__(App);self.s=Store(self.tmp.name);self.app.store=self.s;self.app.init_features();self.p=self.s.put_project('A',{'refs':{},'draft':'unchanged'});self.b=self.s.put_project('B',{'refs':{}});self.pid=self.p['id'];self.file=self.s.root/'assets/source.png';Image.linear_gradient('L').resize((160,240)).convert('RGB').save(self.file);self.digest=self.file.read_bytes();self.s.put_asset({'id':'source','name':'原图','role':'output','source':'uploaded','local':'assets/source.png'},self.pid)
 def tearDown(self):self.s.db.close();self.tmp.cleanup()
 def confirm(self,p=None,key='confirm-unique',pid=None):
  pid=pid or self.pid;c=self.app.retouch_context(pid,'source');return self.app.confirm_retouch(pid,'source',p or {},c['revision'],key)
 def test_confirm_same_asset_original_and_project_unchanged(self):
  a=self.confirm({'exposure':.5});self.assertEqual(a['id'],'source');self.assertEqual(len(self.s.assets(self.pid)),1);self.assertTrue(a['adjusted']);self.assertIn('/files/assets/adjustment-',a['display_url']);self.assertEqual(self.file.read_bytes(),self.digest);self.assertEqual(self.s.jobs(),[]);self.assertEqual(self.s.project(self.pid)['data'],self.p['data']);self.assertEqual(self.s.asset('source').get('photo_adjustment'),None)
 def test_reopen_repeat_no_stacking_and_cleanup(self):
  first=self.confirm({'exposure':.5});old=self.s.root/first['photo_adjustment']['local'];c=self.app.retouch_context(self.pid,'source');self.assertEqual(c['settings']['exposure'],.5);self.assertIn('assets/source.png',c['baseline_url']);second=self.confirm({'exposure':.7},'confirm-second');self.assertFalse(old.exists());actual=Image.open(self.s.root/second['photo_adjustment']['local']);self.assertEqual(actual.tobytes(),render(self.file,{'exposure':.7},2).tobytes());self.assertEqual(len(self.s.assets(self.pid)),1)
 def test_restore_uses_exact_original_file(self):
  a=self.confirm({'shadows':30});old=self.s.root/a['photo_adjustment']['local'];a=self.confirm({},'confirm-restore');self.assertFalse(a['adjusted']);self.assertEqual(a['photo_adjustment']['local'],'assets/source.png');self.assertFalse(old.exists());self.assertEqual(self.file.read_bytes(),self.digest);self.assertEqual(self.app.retouch_context(self.pid,'source')['settings']['shadows'],0)
 def test_retry_idempotence_concurrent_and_stale_window(self):
  c=self.app.retouch_context(self.pid,'source')
  def run(_):return self.app.confirm_retouch(self.pid,'source',{'warmth':10},c['revision'],'confirm-concurrent')
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(run,range(2)))
  self.assertEqual(results[0]['photo_adjustment'],results[1]['photo_adjustment']);self.assertEqual(len(list((self.s.root/'assets').glob('adjustment-*'))),1)
  with self.assertRaisesRegex(ValueError,'其他窗口'):self.app.confirm_retouch(self.pid,'source',{'warmth':20},c['revision'],'confirm-other')
  with self.assertRaises(ValueError):self.app.confirm_retouch(self.pid,'source',{'warmth':20},c['revision'],'confirm-concurrent')
 def test_project_isolation_reuse_and_copy_independent(self):
  self.s.reuse(self.pid,self.b['id'],['source']);a=self.confirm({'warmth':10});self.assertNotIn('photo_adjustment',self.s.asset('source',self.b['id']));other=self.s.put_project('C',{'refs':{}});self.s.reuse(self.pid,other['id'],['source']);copy=self.s.project_action(self.pid,'copy');self.assertEqual(self.s.asset('source',other['id'])['photo_adjustment'],a['photo_adjustment']);self.assertEqual(self.s.asset('source',copy['id'])['photo_adjustment'],a['photo_adjustment']);path=self.s.root/a['photo_adjustment']['local'];self.confirm({'warmth':20},'confirm-another');self.assertTrue(path.exists());self.assertEqual(self.app.retouch_context(other['id'],'source')['settings']['warmth'],10)
 def test_export_import_bundle_preserve_adjusted_and_baseline(self):
  a=self.confirm({'contrast':-12});raw=(self.s.root/a['photo_adjustment']['local']).read_bytes();project=self.app.import_project(self.app.export_project(self.pid));assets=self.s.assets(project['id']);self.assertEqual(len(assets),1);b=assets[0];self.assertEqual((self.s.root/b['photo_adjustment']['local']).read_bytes(),raw);self.assertEqual((self.s.root/b['photo_adjustment']['base_local']).read_bytes(),self.digest);self.assertEqual(self.app.retouch_context(project['id'],b['id'])['settings']['contrast'],-12)
  with zipfile.ZipFile(io.BytesIO(self.app.bundle(self.pid,['source']))) as z:self.assertEqual(z.read(next(n for n in z.namelist() if n.endswith('.png'))),raw)
 def test_tint_and_sharpening_survive_confirm_presets_and_project_export(self):
  recipe={'tint':23,'sharpness':52,'texture':13}
  a=self.confirm(recipe,'extended-recipe');saved=self.s.root/a['photo_adjustment']['local']
  with Image.open(saved) as image:self.assertEqual(image.tobytes(),render(self.file,recipe,2).tobytes())
  preset=self.app.save_preset({'field':'retouch','name':'Detail','settings':recipe})
  self.assertEqual({key:preset['settings'][key] for key in recipe},recipe)
  imported=self.app.import_project(self.app.export_project(self.pid))
  work=self.s.assets(imported['id'])[0]
  restored=self.app.retouch_context(imported['id'],work['id'])['settings']
  self.assertEqual({key:restored[key] for key in recipe},recipe)
  with zipfile.ZipFile(io.BytesIO(self.app.bundle(self.pid,['source']))) as z:
   self.assertEqual(z.read(next(n for n in z.namelist() if n.endswith('.png'))),saved.read_bytes())
 def test_export_import_rejects_bad_adjustment_without_partial_project(self):
  self.confirm({'texture':12});package=self.app.export_project(self.pid);package['assets'][0]['photo_adjustment']['settings']['bogus']=5;before=len(self.s.projects())
  with self.assertRaises(ValueError):self.app.import_project(package)
  self.assertEqual(len(self.s.projects()),before)
 def test_purge_adjustment_removes_private_file_retains_shared_original(self):
  self.s.reuse(self.pid,self.b['id'],['source']);a=self.confirm({'warmth':10});path=self.s.root/a['photo_adjustment']['local'];self.s.asset_action(self.pid,['source'],{'trashed':True});plan=self.s.purge_plan(self.pid,['source']);self.s.purge_assets(self.pid,['source'],plan['token']);self.assertFalse(path.exists());self.assertTrue(self.file.exists());self.assertNotIn('photo_adjustment',self.s.asset('source',self.b['id']))
 def test_purge_shared_adjustment_only_deletes_after_last_reference(self):
  a=self.confirm({'warmth':10});path=self.s.root/a['photo_adjustment']['local'];self.s.reuse(self.pid,self.b['id'],['source'])
  for pid,expected in [(self.pid,True),(self.b['id'],False)]:
   self.s.asset_action(pid,['source'],{'trashed':True});plan=self.s.purge_plan(pid,['source']);self.s.purge_assets(pid,['source'],plan['token']);self.assertEqual(path.exists(),expected)
 def test_failed_publication_leaves_no_new_cache_and_existing_adjustment_unchanged(self):
  a=self.confirm({'warmth':10});before=set((self.s.root/'assets').iterdir());c=self.app.retouch_context(self.pid,'source')
  from contextlib import contextmanager
  @contextmanager
  def fail():raise ValueError('disk unavailable');yield
  with patch.object(self.s,'atomic',fail):
   with self.assertRaises(ValueError):self.app.confirm_retouch(self.pid,'source',{'warmth':20},c['revision'],'confirm-failure')
  self.assertEqual(set((self.s.root/'assets').iterdir()),before);self.assertEqual(self.s.asset('source',self.pid)['photo_adjustment'],a['photo_adjustment'])
 def test_queued_ai_snapshot_uses_current_adjustment_without_overwriting_global_url(self):
  a=self.confirm({'warmth':10});old=self.s.root/a['photo_adjustment']['local'];payload={'mode':'edit','prompt':'adjust','refs':['source'],'resolution':'1K','reference_snapshot':[a]};j=self.s.enqueue('job-snapshot',self.pid,payload);self.confirm({'warmth':20},'confirm-later');self.assertTrue(old.exists());calls=[]
  class Bridge:
   def call(_,name,args):calls.append((name,args));return {'structuredContent':{'url':'https://lovart.ai/adjusted.png'}}
  self.app.bridge=Bridge();url=self.app.hosted('source','provider-project',a);self.assertEqual(url,'https://lovart.ai/adjusted.png');self.assertEqual(base64.b64decode(calls[0][1]['data_base64']),old.read_bytes());self.assertNotIn('url',self.s.asset('source'));self.s.update(j['id'],state='completed');self.s.cleanup_deleted_files();self.assertFalse(old.exists())
 def test_legacy_card_reopens_recipe_then_confirms_in_place_and_restores_root(self):
  old=self.app.save_retouch(self.pid,'source','source',{'exposure':.5},'legacy-creation',2);c=self.app.retouch_context(self.pid,old['id']);self.assertEqual(c['settings']['exposure'],.5);self.assertIn('assets/source.png',c['baseline_url']);a=self.app.confirm_retouch(self.pid,old['id'],{'exposure':.7},c['revision'],'legacy-confirm');self.assertEqual(a['id'],old['id']);self.assertEqual(len(self.s.assets(self.pid)),2);c=self.app.retouch_context(self.pid,old['id']);restored=self.app.confirm_retouch(self.pid,old['id'],{},c['revision'],'legacy-restore');self.assertEqual(restored['photo_adjustment']['local'],'assets/source.png');self.assertEqual(len(self.s.assets(self.pid)),2)
 def test_windows_adjustment_paths_reopen_and_restore_portably(self):
  a=self.confirm({'warmth':10});old=self.s.root/a['photo_adjustment']['local']
  meta=a['project_meta'];adjustment=meta['photo_adjustment'];adjustment['base_local']=r'assets\source.png';adjustment['local']=adjustment['local'].replace('/','\\')
  with self.s.db:
   self.s.db.execute('update project_assets set meta=? where project_id=? and asset_id=?',(json.dumps(meta),self.pid,'source'))
  self.assertEqual(self.s.project_media_path(self.pid,adjustment['local']),old.resolve())
  c=self.app.retouch_context(self.pid,'source');self.assertIn('/files/assets/source.png?',c['baseline_url']);self.assertEqual(c['settings']['warmth'],10)
  self.app.confirm_retouch(self.pid,'source',{},c['revision'],'restore-windows-path')
  saved=json.loads(self.s.db.execute('select meta from project_assets where project_id=? and asset_id=?',(self.pid,'source')).fetchone()[0])['photo_adjustment']
  self.assertEqual((saved['base_local'],saved['local']),('assets/source.png','assets/source.png'))
  self.assertFalse(old.exists());self.assertEqual(self.file.read_bytes(),self.digest)
 def test_http_scope_and_preview_uses_saved_baseline(self):
  import threading,urllib.request,urllib.error
  from http.server import ThreadingHTTPServer
  a=self.confirm({'warmth':10});self.app.catalog=[];self.app.status={'state':'disconnected'};server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=self.app;threading.Thread(target=server.serve_forever,daemon=True).start();url='http://127.0.0.1:'+str(server.server_port)
  try:
   self.assertEqual(urllib.request.urlopen(url+a['display_url']).status,200)
   request=urllib.request.Request(url+'/api/retouch-save',data=json.dumps({'project_id':self.pid,'id':'source','settings':{},'request_key':'old-client'}).encode(),headers={'Content-Type':'application/json','Origin':url})
   with self.assertRaises(urllib.error.HTTPError) as blocked:urllib.request.urlopen(request)
   self.assertIn('本次未新增作品',json.loads(blocked.exception.read())['error']);blocked.exception.close();self.assertEqual(len(self.s.assets(self.pid)),1)
   with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(url+a['display_url'].replace(self.pid,self.b['id']))
   result=self.app.retouch_preview(self.pid,'source',{'warmth':20},2,720,True);self.assertEqual(result['settings']['warmth'],20)
  finally:server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
