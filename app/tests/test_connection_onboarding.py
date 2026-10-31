"""Isolated connection identity and first-run guide; no platform requests."""
import unittest,threading,json,urllib.request
from http.server import ThreadingHTTPServer
import test_agent_channel as support
from agent_identity import identify_agent
from server import Handler

class ConnectionTests(unittest.TestCase):
 setUp=support.AgentTests.setUp;tearDown=support.AgentTests.tearDown;call=support.AgentTests.call
 def test_identity_has_conservative_known_labels_and_unknown_fallback(self):
  for value,label in [('Hermes','Hermes'),('claude-code','Claude Code'),('Codex','Codex'),('workbuddy','WorkBuddy'),('DeepSeek Harness','DeepSeek Harness')]:self.assertEqual(identify_agent(value),(label,'agent_reported'))
  self.assertEqual(identify_agent('mcp','python-sdk'),('AGENT','unknown'))
  self.assertEqual(identify_agent('','Claude Code'),('Claude Code','mcp_client'))
  self.assertEqual(identify_agent('<script>Hermes</script>'),('AGENT','unknown'))
 def test_registered_identity_is_displayed_and_reset_does_not_keep_stale_agent(self):
  self.call('studio_register',agent_name='Hermes',models=support.MODELS)
  self.assertEqual(self.channel.info()['agent'],'Hermes')
  self.channel.configure({'enabled':False})
  self.assertEqual(self.channel.info()['agent'],'AGENT');self.assertFalse(self.channel.info()['ready'])
 def test_generic_client_can_register_without_inventing_an_agent_name(self):
  self.call('studio_register',models=support.MODELS)
  self.assertEqual(self.channel.info()['agent'],'AGENT')
  self.call('studio_register',models=support.MODELS,client_name='Claude Code')
  self.assertEqual(self.channel.info()['agent'],'Claude Code')
  self.assertEqual(self.channel.info()['agent_identity_source'],'mcp_client')
 def test_first_run_guide_dismissal_is_saved_in_data_directory(self):
  server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=self.app
  threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
  try:
   self.assertFalse(json.load(urllib.request.urlopen(base+'/api/setup'))['onboarding']['dismissed'])
   request=urllib.request.Request(base+'/api/onboarding',data=b'{}',headers={'Origin':base,'Content-Type':'application/json'})
   self.assertTrue(json.load(urllib.request.urlopen(request))['ok'])
   self.assertTrue(json.load(urllib.request.urlopen(base+'/api/setup'))['onboarding']['dismissed'])
   self.assertTrue((self.root/'connection-guide-seen').is_file())
  finally:server.shutdown();server.server_close()
