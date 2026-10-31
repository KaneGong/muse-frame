import sys,tempfile,unittest,threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store

class BatchAtomicTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.app=App.__new__(App);self.app.store=Store(self.tmp.name);self.addCleanup(self.app.store.db.close);self.app.execution_lock=threading.RLock()
  self.pid=self.app.store.put_project('test',{'refs':{}})['id']
  def enqueue(p):
   payload=p['payload']
   if payload['prompt']=='invalid':raise ValueError('invalid shot')
   return self.app.store.enqueue(p['request_key'],p['project_id'],payload)
  self.app.enqueue=enqueue
 def req(self):return {'project_id':self.pid,'request_key':'batch-request-123','count':2,'payloads':[{'prompt':'first','resolution':'1K'},{'prompt':'second','resolution':'1K'}]}
 def test_atomic_and_repeated_request(self):
  req=self.req();a=self.app.enqueue_batch(req);b=self.app.enqueue_batch(req)
  self.assertEqual(len(a['jobs']),4);self.assertEqual([j['id'] for j in a['jobs']],[j['id'] for j in b['jobs']]);self.assertEqual(len(self.app.store.jobs(self.pid)),4)
  req['count']=1
  with self.assertRaises(ValueError):self.app.enqueue_batch(req)
 def test_invalid_second_shot_rolls_back_first(self):
  req=self.req();req['payloads'][1]['prompt']='invalid'
  with self.assertRaises(ValueError):self.app.enqueue_batch(req)
  self.assertEqual(self.app.store.jobs(self.pid),[])
 def test_uncertain_task_blocks_only_its_batch(self):
  jobs=self.app.enqueue_batch(self.req())['jobs'];self.app.store.update(jobs[0]['id'],state='needs_review')
  self.assertIsNone(self.app.store.claim())
  req=self.req();req['request_key']='different-batch-123';other=self.app.enqueue_batch(req)['jobs']
  self.assertEqual(self.app.store.claim()['id'],other[0]['id'])
  self.app.store.update(jobs[0]['id'],state='failed')
  self.assertEqual(self.app.store.claim()['id'],jobs[1]['id'])
 def test_platform_not_found_requires_review_and_blocks_group(self):
  jobs=self.app.enqueue_batch(self.req())['jobs'];first=jobs[0]
  self.app.store.update(first['id'],state='running',task_ids=['platform-id'])
  class Bridge:
   def call(self,name,args):return {'structuredContent':{'status':'not_found'}}
  self.app._bridge_for_platform=lambda platform:Bridge()
  self.app.poll(self.app.store.job(first['id']))
  self.assertEqual(self.app.store.job(first['id'])['state'],'needs_review')
  self.assertIsNone(self.app.store.claim())
 def test_restart_keeps_ambiguous_submissions_blocked(self):
  jobs=self.app.enqueue_batch(self.req())['jobs'];self.app.store.update(jobs[0]['id'],state='submitting')
  self.app.store.recover()
  self.assertEqual(self.app.store.job(jobs[0]['id'])['state'],'needs_review')
  self.assertIsNone(self.app.store.claim())
 def test_permanently_removed_project_deletes_batch_manifest(self):
  jobs=self.app.enqueue_batch(self.req())['jobs']
  for j in jobs:self.app.store.update(j['id'],state='cancelled')
  self.app.store.project_action(self.pid,'trash');self.app.store.purge_project(self.pid)
  self.assertEqual(self.app.store.db.execute('select count(*) from batch_requests').fetchone()[0],0)
 def test_cancel_only_pending_jobs_in_this_project(self):
  jobs=self.app.enqueue_batch(self.req())['jobs'];self.app.store.update(jobs[0]['id'],state='running',task_ids=['submitted'])
  result=self.app.cancel_batch_pending(self.pid,'batch-request-123')
  self.assertEqual(result['cancelled'],3);self.assertEqual(self.app.store.job(jobs[0]['id'])['state'],'running')
  self.assertTrue(all(self.app.store.job(j['id'])['state']=='cancelled' for j in jobs[1:]))
  other=self.app.store.put_project('other',{'refs':{}})['id']
  with self.assertRaises(ValueError):self.app.cancel_batch_pending(other,'batch-request-123')
 def test_cancel_batch_rolls_back_when_a_write_fails(self):
  jobs=self.app.enqueue_batch(self.req())['jobs'];self.app.init_features()
  original=self.app.store.update;calls=[]
  def fail_second(*args,**kwargs):
   calls.append(args[0])
   if len(calls)==2:raise RuntimeError('simulated failure')
   return original(*args,**kwargs)
  self.app.store.update=fail_second
  with self.assertRaises(RuntimeError):self.app.cancel_batch_pending(self.pid,'batch-request-123')
  self.assertTrue(all(self.app.store.job(j['id'])['state']=='queued' for j in jobs))
  self.assertEqual(self.app.store.db.execute('select count(*) from task_notices').fetchone()[0],0)
 def test_legacy_batch_block_is_scoped_to_project(self):
  other=self.app.store.put_project('other',{'refs':{}})['id'];payload={'prompt':'legacy','resolution':'1K'}
  one=self.app.store.enqueue('legacy-batch-0',self.pid,payload);self.app.store.enqueue('legacy-batch-1',self.pid,payload);two=self.app.store.enqueue('legacy-batch-2',other,payload)
  self.app.store.update(one['id'],state='needs_review')
  self.assertEqual(self.app.store.claim()['id'],two['id'])
 def test_batch_registration_excludes_concurrent_platform_switch(self):
  started=threading.Event();release=threading.Event();switched=threading.Event();self.app.platform='first';original=self.app.enqueue;seen=[]
  def slow_enqueue(p):
   seen.append(self.app.platform)
   if len(seen)==1:started.set();self.assertTrue(release.wait(2))
   return original(p)
  self.app.enqueue=slow_enqueue
  def switch():
   with self.app.execution_lock:self.app.platform='second';switched.set()
  submit=threading.Thread(target=lambda:self.app.enqueue_batch(self.req()));submit.start();self.assertTrue(started.wait(2))
  worker=threading.Thread(target=switch);worker.start();self.assertFalse(switched.wait(.05));release.set();submit.join(2);worker.join(2)
  self.assertEqual(seen,['first']*4);self.assertTrue(switched.is_set())
 def test_platform_switch_cannot_send_an_unconfirmed_request_to_another_platform(self):
  request=self.req();request['platform']='lovart';self.app.platform='libtv'
  with self.assertRaisesRegex(ValueError,'平台已切换'):self.app.enqueue_batch(request)
  self.assertEqual(self.app.store.jobs(self.pid),[])
  self.app.platform='lovart';original=self.app.enqueue_batch(request);self.app.platform='libtv'
  recovered=self.app.enqueue_batch(request)
  self.assertEqual([j['id'] for j in original['jobs']],[j['id'] for j in recovered['jobs']])
if __name__=='__main__':unittest.main()
