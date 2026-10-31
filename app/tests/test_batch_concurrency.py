import sys,threading,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App

class StopsAfterOneCycle:
 def __init__(self):self.n=0
 def wait(self,_):self.n+=1;return self.n>1
class Store:
 def __init__(self,running):self.running=running;self.claimed=False
 def jobs(self):return [{'id':str(i),'state':'running','payload':{},'updated':10**20} for i in range(self.running)]
 def running_internal(self):return self.jobs()
 def claim(self):self.claimed=True;return {'id':'queued','state':'preparing','payload':{}}
 def job(self,jid):return {'id':jid,'state':'running' if jid not in ['queued'] else 'preparing','payload':{}}
 def update(self,*a,**kw):pass
class BatchConcurrency(unittest.TestCase):
 def make(self,n):
  a=App.__new__(App);a.stop=StopsAfterOneCycle();a.store=Store(n);a.execution_lock=threading.RLock();a.platform='lovart';a.status={'state':'connected'};a.submissions=[];a.submit=lambda j:a.submissions.append(j['id']);return a
 def test_queued_job_can_submit_while_another_platform_task_is_running(self):
  a=self.make(1);a.worker();self.assertEqual(a.submissions,['queued'])
 def test_four_running_tasks_bound_the_number_of_active_tasks(self):
  a=self.make(4);a.worker();self.assertFalse(a.store.claimed)

class LimitedCycles:
 def __init__(self,n):self.n=n
 def wait(self,_):self.n-=1;return self.n<0

class RealStoreScheduling(unittest.TestCase):
 def test_four_jobs_are_running_before_any_completes_and_fifth_remains_queued(self):
  import tempfile
  from store import Store
  with tempfile.TemporaryDirectory() as tmp:
   a=App.__new__(App);a.stop=LimitedCycles(6);a.store=Store(Path(tmp));a.execution_lock=threading.RLock();a.platform='lovart';a.status={'state':'connected'}
   project=a.store.put_project('test',{'refs':{}})
   for i in range(5):a.store.enqueue('request-%d'%i,project['id'],{'prompt':'test','refs':[],'resolution':'2K'})
   self.addCleanup(a.store.db.close)
   a.submit=lambda j:a.store.update(j['id'],state='running',task_ids=['fake-'+j['id']])
   a.worker()
   states=[j['state'] for j in a.store.jobs()]
   self.assertEqual(states.count('running'),4)
   self.assertEqual(states.count('queued'),1)

class PollOrder(unittest.TestCase):
 def test_checks_oldest_due_task_before_claiming_slot(self):
  a=App.__new__(App);a.stop=StopsAfterOneCycle();a.execution_lock=threading.RLock();a.platform='lovart';a.status={'state':'connected'};a.submissions=[]
  class DueStore(Store):
   def jobs(self):return [{'id':'newer','state':'running','payload':{},'updated':1}, {'id':'older','state':'running','payload':{},'updated':0}]
  a.store=DueStore(2);a.poll=lambda j:a.submissions.append('poll:'+j['id']);a.submit=lambda j:a.submissions.append('submit:'+j['id']);a.worker()
  self.assertEqual(a.submissions,['poll:older']);self.assertFalse(a.store.claimed)

class ProviderSimulation(unittest.TestCase):
 def make_app(self,fail=False):
  import tempfile
  from store import Store
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  a=App.__new__(App);a.store=Store(self.tmp.name);self.addCleanup(a.store.db.close);a.execution_lock=threading.RLock();a.platform='libtv';a.status={'state':'connected'};a.model_schema=lambda *args,**kwargs:{'properties':{}}
  class Bridge:
   def __init__(self):self.calls=[]
   def call(self,name,args):
    if name=='generate_image':
     self.calls.append(args)
     if fail:raise RuntimeError('simulated lost response')
     return {'structuredContent':{'status':'pending','task_ids':['task-%d'%len(self.calls)]}}
    raise AssertionError(name)
  a.bridge=Bridge();a._bridge_for_platform=lambda _:a.bridge
  pid=a.store.put_project('synthetic',{'refs':{}})['id'];req={'project_id':pid,'request_key':'mock-batch-123','count':4,'payload':{'prompt':'synthetic','mode':'generate','resultRole':'scene','refs':[],'model':'mock','aspect_ratio':'default','resolution':'default'}}
  jobs=a.enqueue_batch(req)['jobs'];return a,jobs
 def test_four_real_submit_paths_can_be_active_without_waiting_for_results(self):
  a,jobs=self.make_app();a.stop=LimitedCycles(5);a.worker()
  self.assertEqual(len(a.bridge.calls),4)
  self.assertTrue(all(a.store.job(j['id'])['state']=='running' for j in jobs))
  self.assertTrue(all(call['n']==1 for call in a.bridge.calls))
 def test_lost_first_provider_response_prevents_later_group_submissions(self):
  a,jobs=self.make_app(fail=True);a.stop=LimitedCycles(5);a.worker()
  self.assertEqual(len(a.bridge.calls),1)
  self.assertEqual(a.store.job(jobs[0]['id'])['state'],'needs_review')
  self.assertTrue(all(a.store.job(j['id'])['state']=='queued' for j in jobs[1:]))

class ConnectionGuard(unittest.TestCase):
 def test_disconnected_keeps_queued_jobs_until_connection_recovers(self):
  a=BatchConcurrency().make(0);a.status={'state':'disconnected'};a.worker();self.assertFalse(a.store.claimed);self.assertEqual(a.submissions,[])
 def test_platform_lower_limit_is_respected(self):
  a=BatchConcurrency().make(1);a.status={'state':'connected','concurrency_limit':1};a.worker();self.assertFalse(a.store.claimed)
