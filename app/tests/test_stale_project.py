import sys,tempfile,unittest,threading,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from server import App

MODEL='vertex/nano-banana-2-1'
SCHEMA={'type':'object','properties':{'aspect_ratio':{'type':'string','enum':['3:4','16:9']},
                                    'resolution':{'type':'string','enum':['2K']}}}


class StalePlatformProjectTests(unittest.TestCase):
    """A platform project id carried over from another account must not block
    generation: it is a pre-submit refusal, so the id is dropped and the call is
    retried once. A failure after acceptance is never resent."""

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.s=Store(Path(self.tmp.name))
        self.app=App.__new__(App);self.app.store=self.s;self.app.status={}
        self.app.execution_lock=threading.RLock()
        self.app.model_schema=lambda model:SCHEMA
        self.project=self.s.put_project('A',{'refs':{},'draft':''})

    def tearDown(self):
        self.s.db.close();self.tmp.cleanup()

    def payload(self):
        return {'prompt':'设计海边步道的六机位无人环境参考板。','mode':'generate','resultRole':'scene',
                'refs':[],'model':MODEL,'aspect_ratio':'16:9','resolution':'2K','title':'环境参考'}

    class Bridge:
        def __init__(self,refuse_once=True):
            self.tools={};self.calls=[];self.refuse_once=refuse_once
        def call(self,name,args):
            self.calls.append(dict(args))
            if name!='generate_image':raise AssertionError(name)
            if args.get('project_id')=='stale' and self.refuse_once:
                return {'isError':True,'content':[{'type':'text','text':
                    'project "stale" not found on this account; omit project_id to create one'}]}
            return {'structuredContent':{'task_ids':['task-1'],'project_id':'fresh','status':'pending'}}

    def history_with_stale_project(self):
        old=self.s.enqueue('old-request-key',self.project['id'],{**self.payload(),'batch_id':'old'})
        self.s.update(old['id'],state='completed',result={'project_id':'stale'})
        return old

    def test_stale_project_is_dropped_and_retried_once(self):
        self.history_with_stale_project()
        job=self.s.enqueue('new-request-key',self.project['id'],{**self.payload(),'batch_id':'new'})
        bridge=self.Bridge();self.app.bridge=bridge
        self.app.submit(job)
        saved=self.s.job(job['id'])
        self.assertEqual(saved['state'],'running')
        self.assertEqual(saved['task_ids'],['task-1'])
        self.assertEqual(len(bridge.calls),2)
        self.assertEqual(bridge.calls[0].get('project_id'),'stale')
        self.assertNotIn('project_id',bridge.calls[1])
        self.assertIsNone(saved['error'])

    def test_unrelated_refusal_is_not_retried(self):
        job=self.s.enqueue('new-request-key',self.project['id'],{**self.payload(),'batch_id':'new'})
        class Bridge(self.__class__.Bridge):
            def call(self,name,args):
                self.calls.append(dict(args))
                if name=='create_project':
                    return {'structuredContent':{'project_id':'fresh'}}
                return {'isError':True,'content':[{'type':'text','text':'model not enabled for this account'}]}
        bridge=Bridge();self.app.bridge=bridge
        self.app.submit(job)
        saved=self.s.job(job['id'])
        self.assertEqual(saved['state'],'needs_review')
        # create_project 1 次 + generate_image 1 次，generate_image 未重试
        self.assertEqual(len([c for c in bridge.calls if 'prompt' in c]),1)
        self.assertIn('model not enabled',saved['error'])


if __name__=='__main__':
    unittest.main()
