import sys,unittest,tempfile,io,base64,hashlib,math
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store
from retouch import render,settings
class RetouchTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.app=App.__new__(App);self.app.store=Store(self.tmp.name);self.s=self.app.store;self.p=self.s.put_project('A',{'refs':{},'draft':'untouched'});self.other=self.s.put_project('B',{'refs':{},'draft':'B'});self.file=self.s.root/'source.png';self.image=Image.new('RGBA',(64,96),(128,80,40,123));self.image.save(self.file);self.asset=self.s.put_asset({'id':'source','name':'original','role':'output','source':'uploaded','local':'source.png','original_size':[64,96]},self.p['id'])
 def tearDown(self):self.s.db.close();self.tmp.cleanup()
 def test_neutral_is_pixel_exact_and_preserves_alpha(self):
  im=render(self.file,{});self.assertEqual(im.tobytes(),self.image.tobytes());self.assertEqual(im.mode,'RGBA')
 def test_exposure_uses_linear_light_and_settings_have_effect(self):
  result=render(self.file,{'exposure':1});self.assertIn(result.getpixel((0,0))[0],[175,176]);self.assertEqual(result.getpixel((0,0))[3],123)
  warm=render(self.file,{'warmth':50});self.assertGreater(warm.getpixel((0,0))[0],128);self.assertLess(warm.getpixel((0,0))[2],40)
  sat=render(self.file,{'saturation':-50});px=sat.getpixel((0,0));self.assertLess(px[0]-px[2],128-40)
 def test_invalid_and_nonfinite_parameters_rejected(self):
  for p in [None,{'unknown':1},{'exposure':True},{'exposure':3},{'warmth':float('nan')},{'contrast':float('inf')},{'saturation':-51}]:
   with self.subTest(p=p):
    with self.assertRaises(ValueError):settings(p)
 def test_save_is_new_version_original_bytes_and_jobs_untouched(self):
  digest=hashlib.sha256(self.file.read_bytes()).hexdigest();a=self.app.save_retouch(self.p['id'],'source','source',{'exposure':.5},'request-one')
  self.assertNotEqual(a['id'],'source');self.assertEqual(a['parent_id'],'source');self.assertEqual(a['retouch_base_id'],'source');self.assertEqual(a['original_size'],[64,96]);self.assertEqual(hashlib.sha256(self.file.read_bytes()).hexdigest(),digest);self.assertEqual(self.s.jobs(),[]);self.assertEqual(self.s.project(self.p['id'])['data']['draft'],'untouched');self.assertEqual(self.s.assets(self.other['id']),[])
 def test_preview_and_save_use_identical_rendering(self):
  p={'exposure':.5,'contrast':13,'warmth':-9,'saturation':-21};preview=self.app.retouch_preview(self.p['id'],'source',p);a=self.app.save_retouch(self.p['id'],'source','source',p,'request-two');before=Image.open(io.BytesIO(base64.b64decode(preview['image'].split(',')[1])));after=Image.open(self.s.root/a['original_local']);self.assertEqual(before.tobytes(),after.tobytes());self.assertEqual(preview['size'],[64,96])
 def test_same_request_does_not_create_duplicates_and_changed_payload_rejected(self):
  a=self.app.save_retouch(self.p['id'],'source','source',{'exposure':.5},'request-three');b=self.app.save_retouch(self.p['id'],'source','source',{'exposure':.5},'request-three');self.assertEqual(a['id'],b['id']);self.assertEqual(len(self.s.assets(self.p['id'])),2)
  with self.assertRaises(ValueError):self.app.save_retouch(self.p['id'],'source','source',{'exposure':1},'request-three')
 def test_wrong_project_unrelated_parent_and_archived_project_are_rejected(self):
  with self.assertRaises(ValueError):self.app.retouch_preview(self.other['id'],'source',{})
  other=self.s.put_asset({'id':'unrelated','role':'output','name':'other','local':'source.png','source':'uploaded'},self.p['id'])
  with self.assertRaises(ValueError):self.app.save_retouch(self.p['id'],'source',other['id'],{},'request-four')
  self.s.project_action(self.p['id'],'archive')
  with self.assertRaises(ValueError):self.app.retouch_preview(self.p['id'],'source',{})
 def test_preview_only_is_not_silently_edited_as_original(self):
  a=self.s.asset('source');a.update(source='generated',preview_only=True);self.s.put_asset(a)
  with self.assertRaisesRegex(ValueError,'高清原图'):self.app.retouch_preview(self.p['id'],'source',{})
 def test_export_import_preserves_recipe_parent_and_source_remapping(self):
  self.app.init_features();a=self.app.save_retouch(self.p['id'],'source','source',{'contrast':11},'request-five');package=self.app.export_project(self.p['id']);p=self.app.import_project(package);assets=self.s.assets(p['id']);edited=next(a for a in assets if a['source']=='retouched');source=next(a for a in assets if a['source']=='uploaded');self.assertEqual(edited['parent_id'],source['id']);self.assertEqual(edited['retouch_base_id'],source['id']);self.assertEqual(edited['retouch_settings']['contrast'],11);self.assertEqual(edited['retouch_version'],1);self.assertEqual(self.s.jobs(p['id']),[])
 def test_transparent_and_exif_oriented_images_keep_expected_geometry(self):
  exif=Image.Exif();exif[274]=6;Image.new('RGB',(30,20),'blue').save(self.file,'JPEG',exif=exif);self.assertEqual(render(self.file,{}).size,(20,30))
 def test_bad_color_profile_and_high_bit_depth_rejected(self):
  Image.new('RGB',(2,2)).save(self.file,icc_profile=b'invalid')
  with self.assertRaisesRegex(ValueError,'色彩配置'):render(self.file,{})
  Image.new('I;16',(2,2)).save(self.file)
  with self.assertRaises(ValueError):render(self.file,{})
 def test_large_preview_matches_saved_version_resized_from_original(self):
  Image.linear_gradient('L').resize((1800,1200)).convert('RGBA').save(self.file);p={'exposure':.7,'contrast':-12,'saturation':10,'warmth':10};preview=self.app.retouch_preview(self.p['id'],'source',p);a=self.app.save_retouch(self.p['id'],'source','source',p,'request-large');im=Image.open(self.s.root/a['original_local']);self.assertEqual(im.size,(1800,1200));im.thumbnail((1600,1600),Image.Resampling.LANCZOS);small=Image.open(io.BytesIO(base64.b64decode(preview['image'].split(',')[1])));self.assertEqual(im.tobytes(),small.tobytes())
 def test_concurrent_save_retries_publish_only_one_asset(self):
  from concurrent.futures import ThreadPoolExecutor
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.app.save_retouch(self.p['id'],'source','source',{'warmth':10},'request-concurrent'),range(2)))
  self.assertEqual(results[0]['id'],results[1]['id']);self.assertEqual(len(self.s.assets(self.p['id'])),2)
 def test_failed_publication_removes_only_new_file(self):
  from unittest.mock import patch
  before=set(self.s.root.rglob('*.png'))
  with patch.object(self.s,'put_asset',side_effect=ValueError('failed write')):
   with self.assertRaises(ValueError):self.app.save_retouch(self.p['id'],'source','source',{},'request-fail')
  self.assertEqual(set(self.s.root.rglob('*.png')),before);self.assertEqual(len(self.s.assets(self.p['id'])),1)
 def test_v2_tonal_controls_target_distinct_luminance_ranges(self):
  from retouch import render
  pixels=Image.new('RGB',(4,1));pixels.putdata([(20,20,20),(60,60,60),(128,128,128),(240,240,240)]);pixels.save(self.file)
  for key,index,direction in [('highlights',3,-1),('shadows',1,1),('whites',3,1),('blacks',0,1)]:
   adjusted=render(self.file,{key:direction*30},2).convert('RGB');values=[adjusted.getpixel((i,0)) for i in range(4)];original=[pixels.getpixel((i,0)) for i in range(4)];self.assertTrue((values[index][0]-original[index][0])*direction>0,key)
  self.assertEqual(render(self.file,{'shadows':30},2).getpixel((3,0))[:3],(240,240,240));self.assertEqual(render(self.file,{'whites':30},2).getpixel((1,0))[:3],(60,60,60))
 def test_v2_clarity_texture_change_edges_but_not_flat_tones_or_alpha(self):
  from retouch import render
  im=Image.new('RGBA',(100,100),(80,80,80,123));im.paste((170,170,170,123),(50,0,100,100));im.save(self.file)
  for key in ['clarity','texture']:
   positive=render(self.file,{key:40},2);negative=render(self.file,{key:-40},2)
   self.assertGreater(positive.getpixel((50,50))[0],negative.getpixel((50,50))[0]);self.assertEqual(positive.getpixel((0,0)),(80,80,80,123))
 def test_tint_moves_neutral_colors_towards_green_or_magenta(self):
  Image.new('RGBA',(8,8),(128,128,128,123)).save(self.file)
  magenta=render(self.file,{'tint':70},2).getpixel((0,0))
  green=render(self.file,{'tint':-70},2).getpixel((0,0))
  self.assertGreater(magenta[0],magenta[1]);self.assertGreater(magenta[2],magenta[1])
  self.assertLess(green[0],green[1]);self.assertLess(green[2],green[1])
  self.assertEqual(magenta[3],123);self.assertEqual(green[3],123)
 def test_sharpening_enhances_edges_without_changing_flat_tones_or_alpha(self):
  image=Image.new('RGBA',(96,96),(80,80,80,123));image.paste((160,160,160,123),(48,0,96,96));image.save(self.file)
  result=render(self.file,{'sharpness':70},2)
  self.assertLess(result.getpixel((47,48))[0],80);self.assertGreater(result.getpixel((48,48))[0],160)
  self.assertEqual(result.getpixel((10,10)),(80,80,80,123));self.assertEqual(result.getchannel('A').tobytes(),image.getchannel('A').tobytes())
 def test_extended_neutral_values_keep_the_existing_v2_recipe_shape(self):
  self.assertEqual(settings({'tint':0,'sharpness':0},2),settings({},2))
  for value in [{'tint':101},{'tint':-101},{'sharpness':-1},{'sharpness':101}]:
   with self.subTest(value=value),self.assertRaises(ValueError):settings(value,2)
  with self.assertRaises(ValueError):settings({'tint':10},1)
 def test_v2_fast_proxy_cache_is_immutable_and_save_remains_full_size(self):
  from retouch import PROXIES
  Image.linear_gradient('L').resize((1800,1200)).convert('RGBA').save(self.file);p={'highlights':-20,'shadows':20,'texture':10}
  r=self.app.retouch_preview(self.p['id'],'source',p,2,720);self.assertEqual(r['size'],[1800,1200]);self.assertEqual(r['max_edge'],720);self.assertTrue(r['image'].startswith('data:image/jpeg'))
  snapshot=[x[0].tobytes() for x in PROXIES.values()];self.app.retouch_preview(self.p['id'],'source',{'highlights':30},2,720);self.assertEqual(snapshot,[x[0].tobytes() for x in PROXIES.values()])
  a=self.app.save_retouch(self.p['id'],'source','source',p,'request-v2',2);self.assertEqual(a['retouch_version'],2);self.assertEqual(a['retouch_settings']['highlights'],-20)
  with Image.open(self.s.root/a['original_local']) as saved:self.assertEqual(saved.size,(1800,1200))
 def test_v2_controls_ranges_and_proxy_edge_are_validated(self):
  from retouch import settings
  self.assertEqual(len(settings({},2)),10)
  for key in ['highlights','shadows','whites','blacks','clarity','texture']:
   with self.assertRaises(ValueError):settings({key:51},2)
  for edge in [0,20000,True]:
   with self.assertRaises(ValueError):self.app.retouch_preview(self.p['id'],'source',{},2,edge)
  with self.assertRaises(ValueError):settings({},3)
 def test_v2_export_import_keeps_new_settings_and_version(self):
  self.app.init_features();a=self.app.save_retouch(self.p['id'],'source','source',{'highlights':-30,'shadows':15,'whites':8,'blacks':7,'clarity':12,'texture':9},'request-v2-import',2);p=self.app.import_project(self.app.export_project(self.p['id']));b=next(a for a in self.s.assets(p['id']) if a.get('source')=='retouched');self.assertEqual(b['retouch_version'],2);self.assertEqual(b['retouch_settings']['texture'],9);self.assertEqual(b['retouch_settings']['highlights'],-30)
