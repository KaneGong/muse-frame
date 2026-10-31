"""Local transport simulator, only for isolated --data test-data on port8767. No Lovart calls."""
import sys,json,base64,time,threading,uuid
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App,Handler,BASE
from store import Store
class FakeBridge:
 def __init__(self):self.tools={'cancel_task':{}};self.tasks={};self.calls=[]
 def close(self):pass
 def call(self,name,args):
  self.calls.append(name)
  def wrap(m,image=False):return {'structuredContent':m,'content':([{'type':'image','mimeType':'image/jpeg','data':image}] if image else [])}
  if name=='get_credits':return wrap({'credits':999999})
  if name=='describe_model':
   observed=ROOT/'model-schemas.json'
   if observed.exists():return wrap({'schema':json.loads(observed.read_text())[args['model']]})
   return wrap({'schema':{'properties':{'aspect_ratio':{'enum':['3:4','16:9','1:1']},'resolution':{'enum':['1K','2K','4K']}}}})
  if name=='upload_asset':return wrap({'url':'https://a.lovart.ai/test/reference.jpg'})
  if name in ['generate_image','edit_image']:
   tid='fixture-'+uuid.uuid4().hex;self.tasks[tid]=time.time();return wrap({'status':'running','task_ids':[tid],'project_id':'fixture-project'})
  if name=='cancel_task':return wrap({'cancelled':False,'message':'本地测试：模拟平台任务已开始，不能取消。'})
  if name=='get_task_status':return wrap({'status':'completed','task_ids':args['task_ids']})
  if name=='get_task':
   f=next((ROOT/'previews').glob('*.jpg'));return wrap({'status':'completed','project_id':'fixture-project','task_ids':args.get('task_ids',[]),'artifacts':[{'url':'https://a.lovart.ai/test/fixture-result.jpg','width':1536,'height':2048}]},base64.b64encode(f.read_bytes()).decode())
  raise ValueError(name)
ROOT=Path(sys.argv[1]).resolve()
assert ROOT.name=='test-data' and ROOT!=(BASE.parent/'portrait-workbench-v1/data').resolve(),'Simulator requires an isolated test-data directory'
app=App.__new__(App);app.store=Store(ROOT);app.bridge=FakeBridge();app.status={'state':'connected','message':'本地流程模拟 · 不连接平台、不计费','test_mode':True,'credits':999999,'checked_at':time.time()};app.schemas={};app.catalog=[{'name':'vertex/nano-banana-2-1','display_name':'本地流程模拟（无平台调用）'}];app.catalog += [{'name':name,'display_name':name} for name in ['openai/gpt-image-2-5-flare','openai/gpt-image-2-5-sunburst']];app.stop=threading.Event();app.connecting=False;app.execution_lock=threading.RLock();app.init_features();app.play_sound=lambda:True;app.transcribe_pose=lambda path:'本地模拟：人物侧坐，画面左手撑住台面，双膝交叠。';app.store.recover();threading.Thread(target=app.worker,daemon=True).start()
server=ThreadingHTTPServer(('127.0.0.1',8767),Handler);server.app=app
print('ISOLATED SIMULATOR: 8767; no real generation',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:app.stop.set();server.server_close()
