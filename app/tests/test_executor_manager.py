import unittest,tempfile,threading,sys,json,time,os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from executor_manager import ExecutorManager
class ManagerTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.channel=SimpleNamespace(settings={'enabled':True,'platform':'Lovart'},session=None,executor_instance_id='',last_seen=0,executor_capabilities=[],catalog=[],agent_name='',info=lambda:{'ready':False,'last_seen':0,'registered_model_count':0,'executor_capabilities':[]},configuration=lambda:{'mcpServers':{'portrait-studio':{'command':sys.executable,'args':['fixture.py','--data',str(self.root)]}}})
  self.store=SimpleNamespace(root=self.root,lock=threading.RLock(),jobs=lambda:[],db=SimpleNamespace(execute=lambda *a:SimpleNamespace(fetchone=lambda:None)))
  self.app=SimpleNamespace(store=self.store,agent_channel=self.channel,stop=threading.Event(),execution_lock=threading.RLock(),status={})
  self.manager=ExecutorManager(self.app,start_thread=False)
 def tearDown(self):self.manager.close();self.tmp.cleanup()
 def configure(self):
  with patch.object(self.manager,'preflight',return_value={'ok':True}):return self.manager.configure({'adapter':'hermes','python':sys.executable,'agent_home':str(self.root)})
 def test_no_configuration_never_launches(self):
  with patch('executor_manager.subprocess.Popen') as p:self.manager.tick();p.assert_not_called()
  self.assertEqual(self.manager.info()['state'],'unconfigured')
 def test_packaged_worker_never_writes_bytecode_into_signed_bundle(self):
  self.assertEqual(self.manager.env()['PYTHONDONTWRITEBYTECODE'],'1')
 def test_configuration_rejects_unknown_driver_and_missing_interpreter(self):
  for p in [{'adapter':'shell','python':sys.executable},{'adapter':'hermes','python':'/does/not/exist'}]:
   with self.assertRaises(ValueError):self.manager.configure(p)
 def test_stop_persists_intent_and_does_not_kill_external_process(self):
  self.configure();self.manager.stop();self.assertFalse(json.loads(self.manager.path.read_text())['desired_running'])
  with patch('executor_manager.subprocess.Popen') as p:self.manager.tick();p.assert_not_called()
 def test_busy_external_executor_is_never_replaced_or_killed(self):
  self.configure();self.channel.info=lambda:{'ready':True,'last_seen':time.time(),'registered_model_count':24,'executor_capabilities':[]}
  with self.assertRaisesRegex(ValueError,'外部'):self.manager.start()
 def test_active_task_prevents_manual_stop_or_reconnect(self):
  self.configure();self.store.jobs=lambda:[{'state':'running'}]
  for f in [self.manager.stop,self.manager.reconnect]:
   with self.assertRaisesRegex(ValueError,'任务'):f()
 def test_status_does_not_claim_connected_without_own_heartbeat(self):
  self.configure();self.manager.desired=True;self.manager.process=SimpleNamespace(pid=99,poll=lambda:None)
  self.assertNotEqual(self.manager.info()['state'],'connected');self.manager.process=None
 def test_credential_payload_is_not_accepted_as_configuration(self):
  with self.assertRaises(ValueError):self.manager.configure({'adapter':'hermes','python':sys.executable,'token':'secret'})
 def test_server_restart_retains_start_intent_but_manual_stop_disables_it(self):
  self.configure();self.manager.desired=True;self.manager.save();other=ExecutorManager(self.app,start_thread=False);self.assertTrue(other.desired);other.stop();self.assertFalse(ExecutorManager(self.app,start_thread=False).desired)
