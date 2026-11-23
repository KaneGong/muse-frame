"""Direct API integrated into the real workbench Store, confirmation and recovery."""
import base64,io,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_beta_integration as fixture
from test_beta_integration import IMAGE,ENCODED
from beta_jobs import enqueue_shots,job_feed,recover_job
from beta_prompt import FULL_OUTFIT_SCALE, compile_prompt
from beta_store import save_workspace
from ark_direct import ArkDirect,MODEL,SIZE

class Response:
    headers={'x-request-id':'fake-request'}
    def __init__(self,data):self.data=data
    def read(self,*args):return self.data
    def __enter__(self):return self
    def __exit__(self,*args):pass

class IntegratedArkTests(unittest.TestCase):
    def setUp(self):
        fixture.IntegrationTests.setUp(self)
        self.app.platform='ark';self.app.bridge=ArkDirect(self.app.store.root)
        self.app._bridges['ark']=self.app.bridge
        self.app.bridge.configure({'api_key':'ark-fake-only-for-integration-tests'})
        self.app.catalog=[{'name':MODEL,'max_references':5}];self.app.schemas={}
        self.request.update(platform='ark',model=MODEL,ratio='3:4',size=SIZE,bodyFromFace=False)
        self.state['assets'] += [{'id':role,'name':role,'image':{'__mfImage':0}} for role in ('scene','pose')]
        sh=self.state['shoots'][0];sh.update(referenceMode='photo',refs=[{'role':'环境','assetId':'scene'}])
        sh['shots'][0].update(poseAsset='pose',poseMode='strict')
        result=save_workspace(self.app,{'state':self.state,'ui':{},'revision':self.saved['revision'],'media':['data:image/webp;base64,'+ENCODED]})
        self.request['revision']=result['revision']
    def tearDown(self):fixture.IntegrationTests.tearDown(self)
    def register(self):
        review=enqueue_shots(self.app,self.request,review=True)
        row=review['shots'][0]
        self.assertEqual([r['role'] for r in row['references']],['face','outfit','scene','pose'])
        self.assertIn('随姿态和场景自然佩戴、携带或落放，允许自然遮挡',row['prompt'])
        self.assertEqual(row['size'],SIZE)
        enqueue_shots(self.app,{**self.request,'reviewToken':review['reviewToken']})
        job=self.app.store.claim()
        self.assertEqual(job['payload']['prompt'],row['prompt'])
        return job
    def test_submit_poll_original_and_local_recovery(self):
        job=self.register()
        def generate(req,timeout):
            body=json.loads(req.data)
            self.assertEqual(len(body['image']),4)
            self.assertEqual(body['model'],MODEL)
            return Response(json.dumps({'model':MODEL,'usage':{'generated_images':1},'data':[{'url':'https://ark-content.tos-cn-beijing.volces.com/test.webp'}]}).encode())
        with patch('ark_direct.urllib.request.urlopen',side_effect=generate) as call:
            self.app.submit(job)
            self.assertEqual(self.app.store.job(job['id'])['state'],'running')
            self.app.store.update(job['id'],state='needs_review',task_ids=[])
            recovered=recover_job(self.app,{'project_id':job['project_id'],'id':job['id'],'action':'lookup'})
            self.assertEqual(recovered['task_id'],job['id'])
            with patch('features.urllib.request.build_opener') as opener:
                opener.return_value.open.return_value=Response(IMAGE)
                self.app.poll(self.app.store.job(job['id']))
            current=self.app.store.job(job['id'])
            self.assertEqual(current['state'],'completed')
            asset=self.app.store.asset(current['result']['asset_ids'][0],job['project_id'])
            self.assertTrue(asset['original_saved'])
            self.assertTrue((self.app.store.root/asset['original_local']).is_file())
            self.assertEqual(call.call_count,1)
    def test_failed_download_recovers_from_existing_image_without_resubmit(self):
        job = self.register()
        result = Response(json.dumps({
            'data': [{'url': 'https://ark-content.tos-cn-beijing.volces.com/test.webp'}],
        }).encode())
        with patch('ark_direct.urllib.request.urlopen', return_value=result) as transport:
            self.app.submit(job)
            with patch('features.urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect = TimeoutError
                self.app.poll(self.app.store.job(job['id']))
                current = self.app.store.job(job['id'])
                self.assertEqual(current['state'], 'needs_review')
                self.assertEqual(current['result']['phase'], 'image_download')
                asset_ids = current['result']['asset_ids']
                self.app.bridge._path(job['id']).write_text('{')
                with self.assertRaises(ValueError):
                    recover_job(self.app, {'project_id': 'wrong-project', 'id': job['id'], 'action': 'save-original'})
                result = recover_job(self.app, {'project_id': job['project_id'], 'id': job['id'], 'action': 'save-original'})
                self.assertEqual(result['action'], 'save-original')
                opener.return_value.open.side_effect = None
                opener.return_value.open.return_value = Response(IMAGE)
                self.app.poll(self.app.store.job(job['id']))
                current = self.app.store.job(job['id'])
                self.assertEqual(current['state'], 'completed')
                self.assertEqual(current['result']['asset_ids'], asset_ids)
                self.assertTrue(self.app.store.asset(asset_ids[0], job['project_id'])['original_saved'])
            self.assertEqual(transport.call_count, 1)

    def test_existing_rejection_and_expired_original_are_actionable(self):
        job = self.register()
        with patch('ark_direct.urllib.request.urlopen', return_value=Response(json.dumps({
            'data': [{'url': 'https://ark-content.tos-cn-beijing.volces.com/test.webp'}],
        }).encode())) as transport:
            self.app.submit(job)
            with patch('features.urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect = HTTPError('https://example.test', 403, '', {}, None)
                self.app.poll(self.app.store.job(job['id']))
            row = job_feed(self.app.store)['jobs'][0]
            self.assertTrue(row['arkImageReceipt'])
            self.assertEqual(row['state'], 'needs_review')
            self.assertEqual(row['arkDiagnostic']['download_http'], 403)
            self.assertIn('可能已失效', row['error'])
            self.assertEqual(transport.call_count, 1)

        self.app.store.update(job['id'], state='failed', result={
            'http': 400, 'provider_code': 'InputImageSensitiveContentDetected.PrivacyInformation',
            'request_id': 'fake-request',
        }, error='旧版通用提示')
        row = job_feed(self.app.store)['jobs'][0]
        self.assertFalse(row['arkImageReceipt'])
        self.assertIn('输入图片未通过方舟审核', row['error'])
        self.assertEqual(row['arkDiagnostic']['request_id'], 'fake-request')

    def test_saved_full_outfit_preset_reaches_ark_as_tight_full_length(self):
        shot = self.state['shoots'][0]['shots'][0]
        shot.update(framingId='full', options={
            'shot': {'value': '全身，从头顶到鞋履完整入画', 'source': 'quick'},
            'scale': {'value': '人物占画面主要高度，头顶与脚下留适量边距', 'source': 'quick'},
            'angle': {'value': '低机位适度仰拍', 'source': 'catalog'},
        })
        media = ['data:image/webp;base64,' + ENCODED]
        saved = save_workspace(self.app, {'state': self.state, 'ui': {},
                               'revision': self.request['revision'], 'media': media})
        self.request['revision'] = saved['revision']
        row = enqueue_shots(self.app, self.request, review=True)['shots'][0]
        framing = row['prompt'].split('【构图与机位】', 1)[1]
        self.assertIn('景别：紧凑全身，按当前姿态完整纳入人物、鞋履和关键接触点', framing)
        self.assertIn('背景家具可部分出框', framing)
        self.assertIn('机位：低机位适度仰拍', framing)
        scale = next(o['value'] for o in row['options'] if o['field'] == 'scale')
        self.assertIn('人物轮廓约占画面高度的85%', scale)
        self.assertIn('人物占比：' + scale, framing)
        job = self.register()
        with patch('ark_direct.urllib.request.urlopen', return_value=Response(json.dumps({
            'data': [{'url': 'https://ark-content.tos-cn-beijing.volces.com/test.webp'}]
        }).encode())) as transport:
            self.app.submit(job)
        self.assertEqual(json.loads(transport.call_args.args[0].data)['prompt'], row['prompt'])
        for source, value in (('custom', '保留大块背景'), ('cleared', '')):
            shot['options']['scale'] = {'source': source, 'value': value}
            prompt, fields = compile_prompt({}, shot, {'face':'f','outfit':'o','scene':'s'}, None)
            self.assertEqual(fields['scale'], value)
            self.assertNotIn(FULL_OUTFIT_SCALE, prompt)

    def test_uncertain_submission_stays_review_and_is_never_replayed(self):
        job=self.register()
        with patch('ark_direct.urllib.request.urlopen',side_effect=TimeoutError) as call:
            self.app.submit(job)
            task = self.app.store.job(job['id'])
            self.assertEqual(task['state'], 'needs_review')
            self.assertFalse(task.get('task_ids'))
            with self.assertRaisesRegex(ValueError, '没有可恢复'):
                recover_job(self.app,{'project_id':job['project_id'],'id':job['id'],'action':'lookup'})
            self.assertEqual(call.call_count,1)

if __name__=='__main__':unittest.main()
