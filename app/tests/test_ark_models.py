import io,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ark_direct import ArkDirect,MODEL
from ark_models import schema,SPECS,RATIOS
class Response(io.BytesIO):
    headers={}
class ModelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.bridge=ArkDirect(self.tmp.name);self.bridge.configure({'api_key':'fake-key-for-model-discovery-only'})
    def tearDown(self):self.tmp.cleanup()
    def test_live_catalog_filter_pagination_and_no_generate(self):
        responses=[{'data':[{'id':MODEL},{'id':'text-model'}],'has_more':True,'last_id':'cursor'}, {'data':[{'id':MODEL},{'id':'future-image','output_modalities':['image']}]}]
        with patch('ark_direct.urllib.request.urlopen',side_effect=[Response(json.dumps(r).encode()) for r in responses]) as call:
            result=self.bridge.call('list_models',{})['structuredContent']
        self.assertEqual(len(result['models']),2);self.assertEqual(result['models'][0]['catalog_source'],'api')
        self.assertTrue(all(c.args[0].get_method()=='GET' for c in call.call_args_list))
        self.assertIn('after=cursor',call.call_args_list[1].args[0].full_url)
        with self.assertRaisesRegex(ValueError,'尚无'):schema('future-image')
    def test_failure_is_labelled_not_silent_success_and_no_key_leak(self):
        with patch('ark_direct.urllib.request.urlopen',side_effect=HTTPError('url',404,'error',{},io.BytesIO(b'private'))):
            result=self.bridge.call('list_models',{})['structuredContent']
        self.assertIn('并非账号已授权',result['message']);self.assertNotIn('private',str(result));self.assertGreater(len(result['models']),1)
        with patch('ark_direct.urllib.request.urlopen',side_effect=HTTPError('url',401,'error',{},None)):
            with self.assertRaisesRegex(ValueError,'401'):self.bridge.call('list_models',{})
    def test_size_sets_exact_ratios_and_documented_pixel_bounds(self):
        for model,(_,levels,_) in SPECS.items():
            info=schema(model);sizes=info['properties']['size']['enum'];ratios=set()
            for size in sizes:
                w,h=map(int,size.split('x'));ratios.add(round(w/h,8))
                minimum=3686400 if model.startswith(('doubao-seedream-5-0-lite','doubao-seedream-5-0-260','doubao-seedream-4-5')) else 921600
                maximum=4624220 if levels[-1]==2048 else 16777216
                self.assertTrue(minimum<=w*h<=maximum,(model,size));self.assertIn(size,info['x-size-labels'])
            self.assertTrue({round(w/h,8) for w,h in RATIOS}<=ratios)
if __name__=='__main__':unittest.main()
