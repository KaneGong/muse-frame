import sys,tempfile,unittest,json,io,base64,sqlite3,threading,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from server import App,Handler
from http.server import ThreadingHTTPServer
from PIL import Image
class PurgeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.s=Store(self.temp.name);self.app=App.__new__(App);self.app.store=self.s;self.app.init_features();self.a=self.s.put_project('A',{'refs':{},'draft':'原提示词','customPoses':[]});self.b=self.s.put_project('B',{'refs':{},'draft':'其他项目'});self.pid=self.a['id']
 def tearDown(self):self.s.db.close();self.temp.cleanup()
 def asset(self,aid='photo',pid=None,**more):
  rel='assets/'+aid+'.png';(self.s.root/rel).write_bytes(b'ORIGINAL-'+aid.encode());a=self.s.put_asset({'id':aid,'name':aid,'role':'output','source':'uploaded','local':rel,'original_local':rel,**more},pid or self.pid);return a
 def trash(self,ids,pid=None):self.s.asset_action(pid or self.pid,ids,{'trashed':True})
 def purge(self,ids,pid=None):
  pid=pid or self.pid;p=self.s.purge_plan(pid,ids);return self.s.purge_assets(pid,ids,p['token'])
 def test_unshared_photo_removes_record_and_unique_files_and_cannot_restore(self):
  a=self.asset();self.trash(['photo']);r=self.purge(['photo']);self.assertEqual(r['deleted_files'],1);self.assertEqual(r['freed_bytes'],14);self.assertFalse((self.s.root/a['local']).exists());self.assertEqual(self.s.assets(self.pid),[]);self.assertTrue(self.s.was_purged(self.pid,'photo'))
  with self.assertRaises(ValueError):self.s.asset_action(self.pid,['photo'],{'trashed':False})
 def test_only_trash_scope_and_whole_selection_validated_before_mutation(self):
  self.asset('one');self.asset('two');self.trash(['one'])
  for pid,ids in [(self.b['id'],['one']),(self.pid,['one','two']),(self.pid,['one','one']),(self.pid,['missing'])]:
   with self.assertRaises(ValueError):self.s.purge_plan(pid,ids)
  self.assertEqual(len(self.s.assets(self.pid)),2);self.assertTrue((self.s.root/'assets/one.png').exists())
 def test_shared_photo_removes_only_membership_and_last_project_releases_file(self):
  a=self.asset();self.s.reuse(self.pid,self.b['id'],['photo']);self.s.project_action(self.b['id'],'archive');self.trash(['photo']);r=self.purge(['photo']);self.assertEqual(r['shared_count'],1);self.assertEqual(r['freed_bytes'],0);self.assertTrue((self.s.root/a['local']).exists());self.assertFalse(self.s.asset('photo',self.b['id'])['trashed']);self.s.project_action(self.b['id'],'activate');self.trash(['photo'],self.b['id']);self.purge(['photo'],self.b['id']);self.assertFalse((self.s.root/a['local']).exists())
 def test_trashed_project_still_protects_shared_original(self):
  a=self.asset();self.s.reuse(self.pid,self.b['id'],['photo']);self.s.project_action(self.b['id'],'trash');self.trash(['photo']);self.purge(['photo']);self.assertTrue((self.s.root/a['local']).exists());self.assertEqual(self.s.asset('photo',self.b['id'])['id'],'photo')
 def test_shared_path_under_different_asset_id_including_alias_is_retained(self):
  a=self.asset();self.s.put_asset({'id':'alias','name':'alias','local':'assets/./photo.png','role':'output'},self.b['id']);self.trash(['photo']);r=self.purge(['photo']);self.assertEqual(r['freed_bytes'],0);self.assertEqual(r['retained_files'],1);self.assertTrue((self.s.root/a['local']).exists())
 def test_local_retouch_base_blocked_until_derivatives_are_in_same_selection(self):
  self.asset('base');self.asset('child',retouch_base_id='base',retouch_version=2);self.trash(['base','child']);p=self.s.purge_plan(self.pid,['base']);self.assertTrue(p['blocked'])
  with self.assertRaises(ValueError):self.s.purge_assets(self.pid,['base'],p['token'])
  r=self.purge(['base','child']);self.assertEqual(r['pruned_asset_count'],2);self.assertEqual(r['deleted_files'],2)
 def test_foreign_retouch_dependency_kept_and_cleaned_when_last_child_is_removed(self):
  self.asset('base');self.asset('child',self.b['id'],retouch_base_id='base');self.trash(['base']);r=self.purge(['base']);self.assertEqual(r['retained_source_count'],1);self.assertTrue((self.s.root/'assets/base.png').exists());self.trash(['child'],self.b['id']);r=self.purge(['child'],self.b['id']);self.assertEqual(r['pruned_asset_count'],2);self.assertFalse((self.s.root/'assets/base.png').exists())
 def test_running_task_in_other_project_protects_input(self):
  self.asset();self.s.reuse(self.pid,self.b['id'],['photo']);self.trash(['photo']);j=self.s.enqueue('active-purge-refs',self.b['id'],{'prompt':'text','refs':['photo'],'resolution':'2K'});p=self.s.purge_plan(self.pid,['photo']);self.assertTrue(p['blocked'])
  with self.assertRaises(ValueError):self.s.purge_assets(self.pid,['photo'],p['token'])
  self.s.update(j['id'],state='cancelled');self.assertFalse(self.s.purge_plan(self.pid,['photo'])['blocked'])
 def test_running_analysis_protects_image(self):
  self.asset();self.trash(['photo']);self.s.db.execute("insert into analyses values('analysis',?,?,'running',NULL,NULL,1,1)",(self.pid,'photo'));self.s.db.commit();self.assertTrue(self.s.purge_plan(self.pid,['photo'])['blocked'])
 def test_restore_or_new_reuse_after_plan_invalidates_confirmation(self):
  self.asset();self.trash(['photo']);p=self.s.purge_plan(self.pid,['photo']);self.s.asset_action(self.pid,['photo'],{'trashed':False})
  with self.assertRaises(ValueError):self.s.purge_assets(self.pid,['photo'],p['token'])
  self.trash(['photo']);p=self.s.purge_plan(self.pid,['photo']);self.s._link(self.b['id'],'photo');self.s.db.commit()
  with self.assertRaisesRegex(ValueError,'已变化'):self.s.purge_assets(self.pid,['photo'],p['token'])
  self.assertTrue((self.s.root/'assets/photo.png').exists())
 def test_unrelated_project_upload_does_not_invalidate_confirmed_selection(self):
  self.asset();self.trash(['photo']);p=self.s.purge_plan(self.pid,['photo']);self.asset('unrelated',self.b['id']);r=self.s.purge_assets(self.pid,['photo'],p['token']);self.assertEqual(r['removed'],['photo']);self.assertTrue((self.s.root/'assets/unrelated.png').exists())
 def test_new_file_reusing_purged_path_is_not_deleted_after_reopen(self):
  self.asset();self.trash(['photo'])
  with patch.object(Path,'unlink',side_effect=PermissionError('locked')):self.purge(['photo'])
  self.s.put_asset({'id':'other','name':'other','local':'assets/photo.png'},self.b['id']);self.s.db.close();self.s=Store(self.temp.name);self.app.store=self.s;self.assertTrue((self.s.root/'assets/photo.png').exists());self.assertEqual(self.s.pending_file_cleanup(),0)
 def test_invalid_token_and_path_or_symlink_cannot_delete_external_file(self):
  self.asset();self.trash(['photo'])
  with self.assertRaises(ValueError):self.s.purge_assets(self.pid,['photo'],'invalid')
  external=self.s.root/'important.txt';external.write_text('keep');self.s.put_asset({'id':'bad','name':'bad','local':'../important.txt'},self.pid);self.trash(['bad'])
  with self.assertRaises(ValueError):self.s.purge_plan(self.pid,['bad'])
  (self.s.root/'assets/link.png').symlink_to(external);self.s.put_asset({'id':'link','name':'link','local':'assets/link.png'},self.pid);self.trash(['link'])
  with self.assertRaises(ValueError):self.s.purge_plan(self.pid,['link'])
  self.assertEqual(external.read_text(),'keep')
 def test_database_failure_rolls_back_without_touching_files(self):
  self.asset();self.trash(['photo']);p=self.s.purge_plan(self.pid,['photo']);self.s.db.execute("create trigger fail_purge before delete on assets begin select raise(ABORT,'test failure'); end;")
  with self.assertRaises(sqlite3.DatabaseError):self.s.purge_assets(self.pid,['photo'],p['token'])
  self.assertEqual(len(self.s.assets(self.pid)),1);self.assertFalse(self.s.was_purged(self.pid,'photo'));self.assertTrue((self.s.root/'assets/photo.png').exists());self.assertEqual(self.s.pending_file_cleanup(),0)
 def test_failed_file_cleanup_is_durable_and_retries_on_reopen(self):
  self.asset();self.trash(['photo'])
  with patch.object(Path,'unlink',side_effect=PermissionError('test locked')):r=self.purge(['photo'])
  self.assertEqual(r['freed_bytes'],0);self.assertEqual(r['pending_files'],1);self.assertEqual(self.s.assets(self.pid),[]);self.s.db.close();self.s=Store(self.temp.name);self.app.store=self.s;self.assertEqual(self.s.pending_file_cleanup(),0);self.assertFalse((self.s.root/'assets/photo.png').exists())
 def test_cleanup_does_not_remove_changed_or_newly_referenced_file(self):
  self.asset();self.trash(['photo'])
  with patch.object(Path,'unlink',side_effect=PermissionError('locked')):self.purge(['photo'])
  (self.s.root/'assets/photo.png').write_bytes(b'NEW CONTENT');r=self.s.cleanup_deleted_files();self.assertEqual(r['pending_files'],1);self.assertEqual((self.s.root/'assets/photo.png').read_bytes(),b'NEW CONTENT');self.s.put_asset({'id':'new','name':'new','local':'assets/photo.png'},self.b['id']);r=self.s.cleanup_deleted_files();self.assertEqual(r['pending_files'],0);self.assertEqual(r['retained_files'],1);self.assertTrue((self.s.root/'assets/photo.png').exists())
 def test_project_image_links_cleaned_without_rewriting_prompt_or_other_project(self):
  self.asset();p=self.s.project(self.pid);d=p['data'];d.update(refs={'pose':'photo'},savedResults=['photo'],customPoses=[{'id':'pose','name':'pose','assetId':'photo','image':'old','prompt':'坐姿文字'}],undo=[{'text':'旧文字','refs':{'pose':'photo'}}],pendingChanges={'pose':{'poseAsset':'photo','value':'动作'}});self.s.put_project('A',d,self.pid,p['revision']);before=self.s.project(self.b['id']);self.trash(['photo']);r=self.purge(['photo']);d=r['project']['data'];self.assertEqual(d['draft'],'原提示词');self.assertEqual(d['refs']['pose'],'');self.assertEqual(d['customPoses'][0]['prompt'],'坐姿文字');self.assertEqual(d['customPoses'][0]['assetId'],'');self.assertEqual(d['undo'][0]['refs']['pose'],'');self.assertEqual(d['pendingChanges']['pose']['poseAsset'],'');self.assertEqual(self.s.project(self.b['id']),before);self.assertEqual(self.app.import_project(self.app.export_project(self.pid))['data']['draft'],'原提示词')
 def test_permanent_removal_drops_embedded_snapshot_image_but_preserves_history_text(self):
  self.asset();j=self.s.enqueue('history-copy-purge',self.pid,{'refs':['photo'],'prompt':'历史原文','model':'test','resolution':'2K','reference_snapshot':[{'id':'photo','name':'旧名','preview':'data:image/png;base64,AAAA','local':'assets/photo.png','role':'output'}]});self.s.update(j['id'],state='completed');old=self.s.job(j['id']);self.trash(['photo']);self.purge(['photo']);new=self.s.job(j['id']);self.assertEqual(new['payload']['prompt'],'历史原文');self.assertEqual(new['created'],old['created']);self.assertEqual(new['updated'],old['updated']);self.assertEqual(new['events'],old['events']);snapshot=new['payload']['reference_snapshot'][0];self.assertEqual(snapshot['name'],'旧名');self.assertTrue(snapshot['image_removed']);self.assertNotIn('preview',snapshot);self.assertNotIn('local',snapshot)
 def test_global_preset_only_trash_and_current_revision_can_be_permanently_deleted(self):
  p=self.app.save_preset({'field':'retouch','name':'tone','settings':{'shadows':10}})
  with self.assertRaises(ValueError):self.app.purge_preset(p)
  deleted=self.app.save_preset({**p,'archived':True})
  with self.assertRaises(ValueError):self.app.purge_preset(p)
  self.app.purge_preset(deleted);self.assertEqual(self.app.presets(),[]);self.assertEqual(self.s.project(self.pid)['data']['draft'],'原提示词')
 def test_pose_preset_removal_keeps_image_and_applied_prompt(self):
  a=self.asset();p=self.s.project(self.pid);p['data'].update(customPoses=[{'id':'pose','name':'pose','prompt':'坐姿','assetId':'photo','archived':True}],favorites=['pose']);p=self.s.put_project('A',p['data'],self.pid,p['revision']);r=self.app.purge_pose({'project_id':self.pid,'id':'pose','revision':p['revision']});self.assertEqual(r['project']['data']['customPoses'],[]);self.assertEqual(r['project']['data']['favorites'],[]);self.assertTrue((self.s.root/a['local']).exists());self.assertEqual(r['project']['data']['draft'],'原提示词')
 def test_late_original_request_does_not_recreate_purged_photo_or_file(self):
  self.asset(source='generated',original_local=None,url='https://a.lovart.ai/photo.png');self.trash(['photo']);out=io.BytesIO();Image.new('RGB',(3,3)).save(out,'PNG');raw=out.getvalue();owner=self
  class Response(io.BytesIO):
   def __enter__(self):return self
   def __exit__(self,*args):self.close()
  class Opener:
   def open(self,*args,**kwargs):owner.purge(['photo']);return Response(raw)
  with patch('features.urllib.request.build_opener',return_value=Opener()):
   with self.assertRaises(ValueError):self.app.original(self.pid,'photo')
  self.assertFalse((self.s.root/'assets/original-photo.png').exists());self.assertEqual(self.s.assets(self.pid),[])
 def test_late_platform_preview_does_not_recreate_purged_photo(self):
  self.s.put_asset({'id':'photo','name':'photo','role':'output','task_id':'task'},self.pid);self.trash(['photo']);owner=self
  class Bridge:
   def call(self,*args):owner.purge(['photo']);return {'content':[{'type':'image','data':base64.b64encode(b'preview').decode()}]}
  self.app.bridge=Bridge()
  with self.assertRaises(ValueError):self.app.preview_asset('photo',self.pid)
  self.assertFalse((self.s.root/'previews/photo.jpg').exists())
 def test_recapturing_old_results_does_not_resurrect_permanent_removal(self):
  j=self.s.enqueue('purged-capture-job',self.pid,{'refs':[],'prompt':'history','resolution':'2K','resultRole':'output'});self.s.update(j['id'],state='completed');aid=j['id']+'-0';self.asset(aid,job_id=j['id']);self.trash([aid]);self.purge([aid]);r=self.app.capture(self.s.job(j['id']),{'content':[{'type':'image','mimeType':'image/jpeg','data':base64.b64encode(b'preview').decode()}]},{'artifacts':[{'url':'https://a.lovart.ai/image.png'}]});self.assertEqual(r['asset_ids'],[]);self.assertEqual(self.s.assets(self.pid),[]);self.assertFalse((self.s.root/('previews/'+aid+'.jpg')).exists());self.assertEqual(self.s.job(j['id'])['payload']['prompt'],'history')
 def test_http_plan_purge_and_file_read_scope(self):
  a=self.asset();self.trash(['photo']);self.app.catalog=[];self.app.status={'state':'disconnected'};server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=self.app;threading.Thread(target=server.serve_forever,daemon=True).start();url='http://127.0.0.1:'+str(server.server_port)
  def post(path,value):return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps(value).encode(),headers={'Content-Type':'application/json','Origin':url})))
  try:
   with self.assertRaises(urllib.error.HTTPError) as e:post('/api/assets-purge-plan',{'project_id':self.b['id'],'ids':['photo']})
   e.exception.close();p=post('/api/assets-purge-plan',{'project_id':self.pid,'ids':['photo']});r=post('/api/assets-purge',{'project_id':self.pid,'ids':['photo'],'token':p['token']});self.assertEqual(r['deleted_files'],1)
   with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(url+'/files/'+a['local']+'?project_id='+self.pid)
   e.exception.close()
  finally:server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
