import unittest,sys,tempfile,json,asyncio
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import hermes_executor as worker
from unittest.mock import patch
class MCPError(Exception):pass
class Failing:
 async def call_tool(self,*a,**k):raise MCPError('connection closed Bearer private-secret token="private-token"')
class MCPFailureTests(unittest.IsolatedAsyncioTestCase):
 async def test_transport_failure_names_tool_and_records_only_safe_error(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(worker,'STUDIO_DATA',tmp):
   with self.assertRaises(worker.MCPCallFailure) as raised:await worker.call(Failing(),'upload_asset',{'data_base64':'never-log-this-image'})
   self.assertEqual(raised.exception.tool,'upload_asset');s=(Path(tmp)/'logs/executor-errors.jsonl').read_text();self.assertNotIn('private-secret',s);self.assertNotIn('private-token',s);self.assertNotIn('never-log-this-image',s);self.assertIn('connection closed',s)
 async def test_nontransport_error_keeps_original_type(self):
  class Bad:
   async def call_tool(self,*a,**kw):raise ValueError('bad model')
  with self.assertRaises(ValueError):await worker.call(Bad(),'generate_image')
 async def test_failed_job_recycles_session_instead_of_claiming_next_job(self):
  failure=worker.MCPCallFailure('upload_asset',MCPError('connection closed'))
  async def call(st,tool,args=None):return {'job':{'id':'new'}} if tool=='studio_claim' else {}
  with patch.object(worker,'call',call),patch.object(worker,'recover_jobs',return_value=False),patch.object(worker,'run_job',side_effect=failure):
   with self.assertRaises(worker.MCPCallFailure):await worker.serve_tasks(None,None,[],once=True)
