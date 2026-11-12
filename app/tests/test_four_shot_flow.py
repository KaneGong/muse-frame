"""Four distinct shots through real enqueue/upload/submit/result ownership. No remote calls."""
import copy,json,os,sys,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store

class FourShotFlow(unittest.TestCase):
 def test_both_platforms_keep_four_distinct_requests_and_reversed_results_bound_to_their_shots(self):
  for platform in ['lovart','libtv']:
   with self.subTest(platform=platform),tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{'PORTRAIT_TOKEN_DIR':temp}):
    a=App.__new__(App);a.store=Store(temp);self.addCleanup(a.store.db.close);a.execution_lock=threading.RLock();a.platform=platform;a.status={'state':'connected'}
    a.model_schema=lambda *args,**kw:{'properties':{'aspect_ratio':{'enum':['3:4']},'resolution':{'enum':['2K']}}}
    project=a.store.put_project('isolated four shots',{'refs':{},'platform_projects':{platform:'fixture-project'}});pid=project['id']
    for i,(aid,role) in enumerate([('f','face'),('b','body'),('o','outfit'),('e','scene')]+[('p'+str(i),'pose') for i in range(1,5)]):
     p=Path(temp)/'assets'/(aid+'.png');Image.new('RGB',(8,8),(i*20,40,80)).save(p);a.store.put_asset({'id':aid,'role':role,'name':aid,'local':'assets/'+p.name},pid)
    class Bridge:
     token={'sub':'fixture-account'}
     def __init__(self):self.sent=[]
     def call(self,name,args):
      if name=='upload_asset':
       aid=Path(args['filename']).stem;return {'structuredContent':{'url':'https://assets.lovart.ai/'+aid+'.png' if platform=='lovart' else 'https://cdn.liblib.tv/upload-images/'+aid+'.png','platform_node_id':'node-'+aid,'project_id':'fixture-project'}}
      if name=='generate_image':
       self.sent.append(copy.deepcopy(args));return {'structuredContent':{'task_ids':['task-'+str(len(self.sent))],'project_id':'fixture-project'}}
      if name=='get_task_status':return {'structuredContent':{'status':'completed'}}
      if name=='get_task':return {'structuredContent':{'status':'completed','artifacts':[{'url':'https://assets.lovart.ai/'+args['task_ids'][0]+'.png','width':8,'height':8}]}}
      raise AssertionError(name)
    bridge=Bridge();a.bridge=bridge;a._bridge_for_platform=lambda _:bridge;payloads=[]
    for i,(crop,pose,place) in enumerate([('全身','站立','左侧'),('半身','坐姿','居中'),('特写','抬头','右侧'),('环境远景','行走','左侧')],1):
     refs={'face':'f','body':'b','outfit':'o','scene':'e','pose':'p'+str(i)}
     payloads.append({'prompt':f'镜头{i}：{crop}，{pose}，{place}。图5只提供主要动作。','model':'fixture','mode':'generate','resultRole':'output','aspect_ratio':'3:4','resolution':'2K','ref_bindings':refs,'bodyFromFace':False,'prompt_contract':{'version':2,'compiler':'shot-spec-v2.2','mode':'guided','shot_id':'s'+str(i),'reference_roles':refs,'snapshot':{'mode':'guided','fields':{'shot':crop,'placement':place},'pose':{'source':'reference','assetId':'p'+str(i),'text':pose,'adherence':'natural'}}}})
    jobs=a.enqueue_batch({'project_id':pid,'request_key':'four-shots-fixture-123','count':2,'platform':platform,'payloads':payloads})['jobs'];self.assertEqual(len(jobs),8)
    for job in jobs:a.submit(job)
    self.assertEqual(len(bridge.sent),8)
    for i,request in enumerate(bridge.sent):
     shot=i//2+1;self.assertEqual(request['prompt'],payloads[shot-1]['prompt']);self.assertIn(request['ref_images'][-1],['https://assets.lovart.ai/p'+str(shot)+'.png'] if platform=='lovart' else ['https://cdn.liblib.tv/upload-images/p'+str(shot)+'.png','libtv:node-p'+str(shot)])
     if platform=='libtv':self.assertEqual(request['ref_slots'],request['ref_images'])
    for job in reversed(jobs):a.poll(a.store.job(job['id']))
    outputs=[x for x in a.store.assets(pid) if x['role']=='output'];self.assertEqual(len(outputs),8)
    for output in outputs:
     job=a.store.job(output['job_id']);shot=job['payload']['batch_shot'];self.assertEqual(job['payload']['ref_bindings']['pose'],'p'+str(shot));self.assertEqual(job['payload']['prompt_contract']['shot_id'],'s'+str(shot));self.assertTrue(output['url'].endswith(job['task_ids'][0]+'.png'))

    a.store.db.close()
