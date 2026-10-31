import sys,tempfile,unittest,subprocess,socket,json,time,urllib.request,urllib.error,os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from runtime import data_dir,diagnostics,APP_ID
from launcher import InstanceLock,bind_server,existing_instance
from http.server import BaseHTTPRequestHandler

class LauncherTests(unittest.TestCase):
 def test_data_directory_is_independent_and_override_is_explicit(self):
  from runtime import EDITION
  with patch.dict(os.environ,{'PORTRAIT_STUDIO_DATA':'./my-test-data'}):self.assertEqual(data_dir(),Path('my-test-data').resolve())
  if EDITION=='standalone':
   with patch.dict(os.environ,{},clear=True):self.assertEqual(data_dir(),(Path(__file__).resolve().parents[2]/'data').resolve())
  else:
   with patch.dict(os.environ,{},clear=True),patch('runtime.sys.platform','darwin'):self.assertEqual(data_dir(),Path.home()/'Library/Application Support/AI Portrait Studio')
   with patch.dict(os.environ,{'LOCALAPPDATA':'C:/TestProfile/AppData/Local'},clear=True),patch('runtime.sys.platform','win32'):self.assertEqual(str(data_dir()).replace('\\','/'),'C:/TestProfile/AppData/Local/AI Portrait Studio')
 def test_instance_lock_excludes_second_launcher_and_recovers_after_release(self):
  with tempfile.TemporaryDirectory() as d:
   first=InstanceLock(Path(d));second=InstanceLock(Path(d));self.assertTrue(first.acquire());first.write(8787);self.assertFalse(second.acquire());first.release();self.assertTrue(second.acquire());second.release()
 def test_port_conflict_never_reuses_foreign_service(self):
  with socket.socket() as occupied:
   occupied.bind(('127.0.0.1',0));occupied.listen();port=occupied.getsockname()[1]
   if port>65515:self.skipTest('ephemeral port too close to upper bound')
   server=bind_server(port,BaseHTTPRequestHandler)
   try:self.assertGreater(server.server_port,port)
   finally:server.server_close()
 def test_loopback_startup_does_not_depend_on_reverse_dns(self):
  with patch('socket.getfqdn',side_effect=AssertionError('Loopback startup attempted reverse DNS')):
   server=bind_server(0,BaseHTTPRequestHandler)
  try:
   self.assertEqual(server.socket.getsockname()[0],'127.0.0.1')
   self.assertGreater(server.server_port,0)
  finally:server.server_close()
 def test_diagnostics_does_not_expose_configuration_credentials(self):
  from runtime import EDITION
  if EDITION=='standalone':r=diagnostics()
  else:
   with patch('connections.find_codex',return_value=None):r=diagnostics()
   self.assertEqual(r['connection']['status'],'missing_agent')
  text=json.dumps(r);self.assertNotIn('config.toml',text);self.assertNotIn('headers',text);self.assertNotIn('access_token',text);self.assertNotIn('refresh_token',text)
  self.assertEqual(r['other_agents']['status'],'available')
 def test_unimplemented_connection_is_rejected(self):
  from connections import create_connection
  with self.assertRaises(ValueError):create_connection('hermes',Path.cwd())
 def test_full_launcher_health_single_instance_and_shutdown(self):
  with tempfile.TemporaryDirectory(prefix='portrait-launch-') as d:
   root=Path(d);log=(root/'test.log').open('w');process=subprocess.Popen([sys.executable,str(Path(__file__).resolve().parents[1]/'launcher.py'),'--data',d,'--no-browser'],stdout=log,stderr=subprocess.STDOUT)
   try:
    port=existing_instance(root,timeout=12);self.assertIsNotNone(port);url=f'http://127.0.0.1:{port}'
    with urllib.request.urlopen(url+'/api/health') as r:self.assertEqual(json.load(r)['app_id'],APP_ID)
    with urllib.request.urlopen(url+'/api/state') as r:state=json.load(r)
    self.assertEqual(state['projects'],[]);self.assertEqual(state['connection']['state'],'disconnected')
    result=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'launcher.py'),'--data',d,'--no-browser'],timeout=10,capture_output=True);self.assertEqual(result.returncode,0);self.assertIsNone(process.poll())
    request=urllib.request.Request(url+'/api/shutdown',data=b'{}',headers={'Origin':url,'Content-Type':'application/json'})
    with urllib.request.urlopen(request) as r:self.assertTrue(json.load(r)['ok'])
    process.wait(timeout=8);self.assertEqual(process.returncode,0)
   finally:
    if process.poll() is None:process.terminate();process.wait(timeout=8)
    log.close()
 def test_active_job_and_foreign_origin_prevent_shutdown(self):
  import threading
  from http.server import ThreadingHTTPServer
  from server import App,Handler
  with tempfile.TemporaryDirectory() as d:
   app=App(Path(d));app.store.enqueue('guard-test-request',app.store.put_project('guard',{'refs':{}})['id'],{'prompt':'test','refs':[],'resolution':'1K'})
   server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=app;threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
   try:
    for origin,code in [(url,400),('https://foreign.invalid',403)]:
     request=urllib.request.Request(url+'/api/shutdown',data=b'{}',headers={'Origin':origin,'Content-Type':'application/json'})
     with self.assertRaises(urllib.error.HTTPError) as failure:urllib.request.urlopen(request)
     self.assertEqual(failure.exception.code,code);failure.exception.close();self.assertFalse(app.stop.is_set())
   finally:server.shutdown();server.server_close();app.stop.set();app.bridge.close()
if __name__=='__main__':unittest.main()
