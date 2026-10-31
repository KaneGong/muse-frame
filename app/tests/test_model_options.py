import sys,json,tempfile,unittest,threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model_options import normalize_options,native_params,parameter_rejection
from server import App
from store import Store
SCHEMAS=json.loads((Path(__file__).parent/'model-schemas-20261019.json').read_text())
GPT='openai/gpt-image-2-5-flare';NANO='vertex/nano-banana-2-1'
class ModelOptionTests(unittest.TestCase):
 def test_gpt_uses_actual_pixels_and_omits_unknown_resolution(self):
  for model in [GPT,'openai/gpt-image-2-5-sunburst']:
   p,params=native_params(SCHEMAS[model],{'aspect_ratio':'3:4','resolution':'2K','mode':'generate'});self.assertEqual(p['size'],'1536*2048');self.assertEqual(params,{'size':'1536*2048'});self.assertEqual(p['resolution'],'default')
 def test_native_resolution_is_retained(self):
  _,params=native_params(SCHEMAS[NANO],{'aspect_ratio':'3:4','resolution':'2K','mode':'edit'});self.assertEqual(params,{'aspect_ratio':'3:4','resolution':'2K'})
 def test_model_with_ratio_resolution_and_size_uses_native_ratio_and_resolution(self):
  schema={'properties':{'aspect_ratio':{'enum':['3:4','1:1']},'resolution':{'enum':['2K','3K']},'size':{'enum':['1728*2304','2048*2048']}}}
  p,params=native_params(schema,{'aspect_ratio':'3:4','resolution':'3K','mode':'generate'})
  self.assertNotIn('size',p);self.assertEqual(p['aspect_ratio'],'3:4');self.assertEqual(params,{'resolution':'3K'})
 def test_pixel_resolution_does_not_send_an_unadvertised_ratio(self):
  schema={'properties':{'resolution':{'enum':['1728*2304','2048*2048']}}}
  p,params=native_params(schema,{'aspect_ratio':'3:4','resolution':'1728*2304','mode':'generate'})
  self.assertEqual(p['aspect_ratio'],'default');self.assertEqual(params,{'resolution':'1728*2304'})
  with self.assertRaises(ValueError):normalize_options(schema,{'aspect_ratio':'1:1','resolution':'1728*2304'})
 def test_pixel_resolution_omits_alternative_ratio_for_generate_and_edit(self):
  schema={'properties':{'aspect_ratio':{'enum':['1x1','3x4']},'resolution':{'enum':['1024*1024','864*1152']}}}
  for mode in ['generate','edit']:
   p,params=native_params(schema,{'aspect_ratio':'3:4','resolution':'864*1152','mode':mode})
   self.assertEqual(p['aspect_ratio'],'default');self.assertEqual(params,{'resolution':'864*1152'})
  with self.assertRaises(ValueError):normalize_options(schema,{'aspect_ratio':'1:1','resolution':'864*1152'})
 def test_mismatched_dimensions_rejected_before_enqueue(self):
  with self.assertRaisesRegex(ValueError,'不一致'):normalize_options(SCHEMAS[GPT],{'size':'1024*1024','aspect_ratio':'3:4'})
  with self.assertRaises(ValueError):normalize_options(SCHEMAS[GPT],{'aspect_ratio':'4:5','resolution':'2K'})
 def test_default_and_unknown_params_not_invented(self):
  p,params=native_params(SCHEMAS[GPT],{'aspect_ratio':'default','resolution':'default','mode':'edit'});self.assertEqual(params,{'size':'auto'});self.assertEqual(native_params({'properties':{}},{'resolution':'2K','aspect_ratio':'3:4'})[1],{})
 def test_transport_failure_is_not_parameter_refusal(self):
  self.assertFalse(parameter_rejection('Transport error'));self.assertTrue(parameter_rejection('Lovart 返回错误：[unknown param "resolution"]'))
 def test_only_explicit_parameter_refusals_reclassified_without_retry_or_time_change(self):
  with tempfile.TemporaryDirectory() as folder:
   store=Store(folder);project=store.put_project('QA',{'refs':{}});jobs=[]
   for key,error in [('rejected','Lovart 返回错误：[unknown param "resolution"]'),('ambiguous','Transport failed after submit')]:
    j=store.enqueue('migration-'+key,project['id'],{'prompt':'动作','resolution':'2K','refs':[]});store.update(j['id'],state='needs_review',error=error);jobs.append(store.job(j['id']))
   app=App.__new__(App);app.store=store;app.init_features();self.assertEqual(store.job(jobs[0]['id'])['state'],'failed');self.assertEqual(store.job(jobs[0]['id'])['updated'],jobs[0]['updated']);self.assertEqual(store.job(jobs[1]['id'])['state'],'needs_review');self.assertEqual(len(store.jobs()),2);store.db.close()
 def test_wire_contract_generate_and_edit(self):
  with tempfile.TemporaryDirectory() as folder:
   s=Store(folder);p=s.put_project('QA',{'refs':{}});app=App.__new__(App);app.store=s;app.model_schema=lambda m:SCHEMAS[m]
   s.put_asset({'id':'style','name':'style','role':'pose','url':'https://a.lovart.ai/style.png'},p['id'])
   class Bridge:
    def call(self,name,args):self.last=(name,args);return {'structuredContent':{'status':'pending','task_ids':['existing-test-id']}}
   app.bridge=Bridge()
   for mode in ['generate','edit']:
    payload={'prompt':'参考图1的样式，改变动作为回眸。','model':GPT,'mode':mode,'resultRole':'pose','refs':['style'],'aspect_ratio':'3:4','resolution':'2K'}
    j=app.enqueue({'project_id':p['id'],'request_key':'contract-'+mode,'payload':payload});app.submit(j);name,args=app.bridge.last;self.assertEqual(args['params'],{'size':'1536*2048'});self.assertNotIn('aspect_ratio',args);self.assertEqual(args['images' if mode=='edit' else 'ref_images'],['https://a.lovart.ai/style.png'])
   s.db.close()
 def test_wire_contract_native_fields_and_pixel_resolution(self):
  schemas={
   'native':{'properties':{'aspect_ratio':{'enum':['3:4','1:1']},'resolution':{'enum':['2K','3K']},'size':{'enum':['1728*2304']}}},
   'pixels':{'properties':{'aspect_ratio':{'enum':['3x4','1x1']},'resolution':{'enum':['864*1152','1024*1024']}}}}
  with tempfile.TemporaryDirectory() as folder:
   store=Store(folder);project=store.put_project('QA',{'refs':{}})
   app=App.__new__(App);app.store=store;app.model_schema=lambda model:schemas[model]
   class Bridge:
    def call(self,name,args):self.last=(name,args);return {'structuredContent':{'status':'pending','task_ids':['isolated-test']}}
   app.bridge=Bridge()
   store.put_asset({'id':'ref','name':'reference','role':'pose','url':'https://a.lovart.ai/ref.png'},project['id'])
   for model in schemas:
    for mode in ['generate','edit']:
     payload={'model':model,'mode':mode,'prompt':'合成测试','resultRole':'pose','refs':['ref'],'aspect_ratio':'3:4','resolution':'3K' if model=='native' else '864*1152'}
     job=app.enqueue({'project_id':project['id'],'request_key':model+'-'+mode,'payload':payload});app.submit(job)
     name,args=app.bridge.last
     self.assertEqual(name,'edit_image' if mode=='edit' else 'generate_image')
     self.assertNotIn('size',args['params'])
     self.assertEqual(args['params']['resolution'],payload['resolution'])
     if model=='pixels':self.assertNotIn('aspect_ratio',args);self.assertNotIn('aspect_ratio',args['params'])
     elif mode=='generate':self.assertEqual(args['aspect_ratio'],'3:4')
     else:self.assertEqual(args['params']['aspect_ratio'],'3:4')
   store.db.close()
if __name__=='__main__':unittest.main()
