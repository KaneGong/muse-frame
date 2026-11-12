"""Real local HTTP transport, synthetic credentials, no platform side effects."""
import json,os,sys,tempfile,threading,time,unittest,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import lovart_direct as lovart,libtv_direct as libtv

class TransportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.metrics={'refresh':0,'initialize':0,'writes':0,'stale_initialize':0};metrics=self.metrics
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def send(self,data,status=200,session=None):
    raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)))
    if session:self.send_header('Mcp-Session-Id',session)
    self.end_headers();self.wfile.write(raw)
   def do_POST(self):
    raw=self.rfile.read(int(self.headers['Content-Length']))
    if self.path=='/token':metrics['refresh']+=1;return self.send({'access_token':'fixture-fresh','refresh_token':'fixture-refresh','expires_in':3600})
    if self.headers.get('Authorization')=='Bearer fixture-stale':return self.send({'error':'expired'},401)
    msg=json.loads(raw);method=msg['method'];rid=msg.get('id')
    if method=='initialize':
     if self.headers.get('Mcp-Session-Id'):metrics['stale_initialize']+=1;return self.send({'error':'expired session'},404)
     metrics['initialize']+=1;return self.send({'id':rid,'result':{'protocolVersion':'2025-06-18'}},session='fixture-session-'+str(metrics['initialize']))
    if method=='notifications/initialized':return self.send({})
    if method=='tools/list':return self.send({'id':rid,'result':{'tools':[{'name':n} for n in ['create_node','create_project','get_credits','account_user','list_models','search_models','generate_image']]}})
    name=msg['params']['name']
    if name in ['create_node','generate_image']:metrics['writes']+=1;return self.send({'error':'service unavailable'},503)
    result={'create_project':{'projectId':'fixture-project'},'account_user':{'user':{'id':'fixture'}},'get_credits':{'credits':100},'search_models':{'matches':[{'modelKey':'fixture-image','displayName':'Fixture'}]},'list_models':{'models':[{'name':'fixture-image'}]}}[name]
    return self.send({'id':rid,'result':{'structuredContent':result}})
  self.http=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=self.http.serve_forever,daemon=True).start()
  self.addCleanup(self.http.server_close);self.addCleanup(self.http.shutdown);self.base='http://127.0.0.1:'+str(self.http.server_port)
  self.enterContext(patch.dict(os.environ,{'PORTRAIT_TOKEN_DIR':str(self.root)}));self.enterContext(patch.object(lovart,'MCP_URL',self.base+'/mcp'));self.enterContext(patch.object(lovart,'TOKEN_URL',self.base+'/token'));self.enterContext(patch.object(libtv,'MCP_URL',self.base+'/mcp'));self.enterContext(patch.object(libtv,'ISSUER',self.base+'/'))
  (self.root/'libtv-client.json').write_text(json.dumps({'client_id':'fixture-client','redirect_uris':[libtv.REDIRECT_URI]}))
 def client(self,platform,stale=False):
  (self.root/(platform+'.json')).write_text(json.dumps({'access_token':'fixture-stale' if stale else 'fixture-fresh','refresh_token':'fixture-refresh','sub':'fixture','expires_at':time.time()+3600}))
  return lovart.LovartDirect(token_path=self.root/'lovart.json') if platform=='lovart' else libtv.LibTVBridge()
 def test_both_platforms_reconnect_without_resending_old_session(self):
  for platform in ['lovart','libtv']:
   with self.subTest(platform=platform):
    bridge=self.client(platform);bridge.call('list_models',{});before=self.metrics['initialize'];bridge.close();result=bridge.call('list_models',{})
    self.assertIn('fixture-image',str(result));self.assertEqual(self.metrics['initialize'],before+1);self.assertEqual(self.metrics['stale_initialize'],0);bridge.close()
 def test_both_platforms_refresh_a_401_once_and_continue_the_handshake(self):
  for platform in ['lovart','libtv']:
   with self.subTest(platform=platform):
    bridge=self.client(platform,stale=True);before=self.metrics['refresh'];wire=bridge._opener;errors=[]
    class TrackErrors:
     def open(self,*a,**kw):
      try:return wire.open(*a,**kw)
      except urllib.error.HTTPError as error:errors.append(error);raise
    bridge._opener=TrackErrors();result=bridge.call('list_models',{})
    self.assertIn('fixture-image',str(result));self.assertEqual(self.metrics['refresh'],before+1)
    self.assertTrue(all(e.fp.closed for e in errors),'401 response sockets must close before refresh');bridge.close()
 def test_transport_failure_does_not_replay_a_generation_request(self):
  for platform in ['lovart','libtv']:
   with self.subTest(platform=platform):
    bridge=self.client(platform);bridge.connect();before=self.metrics['writes']
    with self.assertRaises((RuntimeError,OSError)):
     if platform=='lovart':bridge.call('generate_image',{'prompt':'synthetic fixture'})
     else:bridge.tool('create_node',{'prompt':'synthetic fixture'})
    self.assertEqual(self.metrics['writes'],before+1);bridge.close()
