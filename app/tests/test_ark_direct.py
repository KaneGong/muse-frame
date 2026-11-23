import io,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ark_direct import ArkDirect,MODEL,SIZE
from bridge import structured

class Response:
    headers={'x-request-id':'request-test'}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self):return json.dumps({'model':MODEL,'usage':{'input_images':4,'generated_images':1},'data':[{'url':'https://ark-content.tos-cn-beijing.volces.com/result.png'}]}).encode()

class ArkTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.bridge=ArkDirect(self.root)
        self.key='ark-fake-not-a-real-secret-0000';self.bridge.configure({'api_key':self.key})
        self.args={'model':MODEL,'prompt':'四图摄影','params':{'size':SIZE},'ref_images':['data:image/png;base64,YQ==']*4,'receipt':self.bridge.prepare_submission('job-test-1234','四图摄影')}
    def tearDown(self):self.tmp.cleanup()
    def test_request_contract_and_no_resend(self):
        def request(req,timeout):
            data=json.loads(req.data)
            self.assertEqual(data,{'model':MODEL,'prompt':'四图摄影','size':SIZE,'output_format':'png','response_format':'url','watermark':False,'image':self.args['ref_images']})
            self.assertEqual(req.headers['Authorization'],'Bearer '+self.key)
            self.assertEqual(timeout,180)
            # Durable uncertainty marker already exists before side effect.
            self.assertEqual(self.bridge._read('job-test-1234')['status'],'needs_review')
            return Response()
        with patch('ark_direct.urllib.request.urlopen',side_effect=request) as call:
            result=structured(self.bridge.call('generate_image',self.args))
            self.assertEqual(result['status'],'completed')
            self.assertEqual(result['usage']['generated_images'],1)
            self.assertEqual(structured(self.bridge.call('generate_image',self.args)),result)
            self.assertEqual(call.call_count,1)
        text=''.join(p.read_text() for p in self.root.rglob('*.json'))
        self.assertNotIn(self.key,text);self.assertNotIn('data:image',text)
        restarted=ArkDirect(self.root)
        self.assertEqual(structured(restarted.call('get_task',{'task_ids':['job-test-1234']}))['status'],'completed')
        with self.assertRaises(ValueError):restarted.call('list_models',{})
    def test_timeout_blocks_resend(self):
        with patch('ark_direct.urllib.request.urlopen',side_effect=TimeoutError) as call:
            self.assertEqual(structured(self.bridge.call('generate_image',self.args))['status'],'needs_review')
            self.bridge.call('generate_image',self.args);self.assertEqual(call.call_count,1)
    def test_provider_refusal_does_not_echo_secret(self):
        error=HTTPError('url',403,'denied',{},io.BytesIO(self.key.encode()))
        with patch('ark_direct.urllib.request.urlopen',side_effect=error):
            result=structured(self.bridge.call('generate_image',self.args))
        self.assertEqual(result['status'],'failed');self.assertNotIn(self.key,json.dumps(result))
    def test_captures_request_diagnostics_and_classifies_transport_failure(self):
        broken = HTTPError('url', 400, 'bad', {'x-request-id': 'ark-request-1'},
                           io.BytesIO(json.dumps({'error': {'code': 'InvalidParameter', 'param': 'size',
                                                              'message': self.key}}).encode()))
        with patch('ark_direct.urllib.request.urlopen', side_effect=broken) as call:
            result = structured(self.bridge.call('generate_image', self.args))
        self.assertEqual(result['provider_code'], 'InvalidParameter')
        self.assertEqual(result['provider_param'], 'size')
        self.assertEqual(result['request_id'], 'ark-request-1')
        self.assertEqual(result['http'], 400)
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn(self.key, json.dumps(result))
        self.assertEqual(result['request_bytes'], len(call.call_args.args[0].data))
        self.assertEqual(call.call_args.args[0].get_header('X-client-request-id'), result['client_request_id'])
        from urllib.error import URLError
        args = {**self.args, 'receipt': self.bridge.prepare_submission('job-test-5678', '')}
        with patch('ark_direct.urllib.request.urlopen', side_effect=URLError(BrokenPipeError(32, 'broken'))) as call:
            result = structured(self.bridge.call('generate_image', args))
            self.assertEqual(result['phase'], 'request_or_headers')
            self.assertEqual(result['transport_error'], 'BrokenPipeError')
            self.assertEqual(result['errno'], 32)
            self.assertEqual(result['status'], 'needs_review')
            self.bridge.call('generate_image', args)
            self.assertEqual(call.call_count, 1)

    def test_legacy_model_omits_unsupported_format_option(self):
        model = 'doubao-seedream-4-0-250828'
        args = {**self.args, 'model': model, 'params': {'size': '2048x2048'}}
        with patch('ark_direct.urllib.request.urlopen', return_value=Response()) as call:
            self.bridge.call('generate_image', args)
        payload = json.loads(call.call_args.args[0].data)
        self.assertEqual(payload['model'], model)
        self.assertNotIn('output_format', payload)
        self.assertEqual(payload['sequential_image_generation'], 'disabled')

    def test_validation_has_no_network_side_effect(self):
        with patch('ark_direct.urllib.request.urlopen') as call:
            for bad in ({'params':{'size':'1x1'}},{'model':'wrong'},{'n':2},{'ref_images':['https://other.test/a']}):
                with self.assertRaises(ValueError):self.bridge.call('generate_image',{**self.args,**bad})
            call.assert_not_called()
        self.assertFalse(list(self.root.rglob('*.json')))
    def test_clear_key(self):
        self.assertEqual(self.bridge.configure({'clear':True})['configured'],False)
        with self.assertRaises(ValueError):self.bridge.call('list_models',{})


class ArkCredentialTests(unittest.TestCase):
    def test_opt_in_restore_replace_and_forget(self):
        key = 'synthetic-keychain-fixture-01'
        replacement = 'synthetic-keychain-fixture-02'
        session = 'synthetic-keychain-fixture-03'
        saved = ''

        def save(value):
            nonlocal saved
            saved = value

        with tempfile.TemporaryDirectory() as root, \
             patch('ark_direct.sys.platform', 'darwin'), \
             patch('ark_direct.ArkKeychain') as store:
            store.return_value = Mock(read=lambda: saved, save=save, forget=lambda: save(''))
            bridge = ArkDirect(root)
            self.assertEqual(bridge.configure({'api_key': key, 'remember': True}),
                             {'configured': True, 'storage': 'keychain', 'can_remember': True})
            restarted = ArkDirect(root)
            with patch.object(restarted, '_catalog', return_value={'models': []}) as catalog:
                restarted.call('list_models', {})
                catalog.assert_called_once_with(key)
            self.assertEqual(restarted.credential_state()['storage'], 'keychain')
            restarted.configure({'api_key': replacement, 'remember': True})
            self.assertEqual(saved, replacement)
            restarted.configure({'api_key': session})
            self.assertEqual(saved, '')
            self.assertEqual(restarted.credential_state()['storage'], 'session')
            with self.assertRaisesRegex(ValueError, '请输入|输入方舟'):
                ArkDirect(root).call('list_models', {})
            restarted.configure({'api_key': key, 'remember': True})
            self.assertFalse(restarted.configure({'clear': True})['configured'])
            self.assertEqual(saved, '')
            self.assertFalse(list(Path(root).rglob('*.json')))

    def test_failed_save_keeps_current_session_credential(self):
        key = 'synthetic-keychain-fixture-01'
        with tempfile.TemporaryDirectory() as root, \
             patch('ark_direct.sys.platform', 'darwin'), \
             patch('ark_direct.ArkKeychain') as store:
            bridge = ArkDirect(root)
            bridge.configure({'api_key': key})
            store.return_value.save.side_effect = ValueError('keychain locked')
            with self.assertRaisesRegex(ValueError, 'keychain locked'):
                bridge.configure({'api_key': 'synthetic-keychain-fixture-02', 'remember': True})
            with patch.object(bridge, '_catalog', return_value={'models': []}) as catalog:
                bridge.call('list_models', {})
                catalog.assert_called_once_with(key)
            self.assertEqual(bridge.credential_state()['storage'], 'session')

if __name__=='__main__':unittest.main()
