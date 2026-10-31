import base64,hashlib,io,random,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image
from reference_upload import prepare_upload,encoded_size,upload_prefix

class UploadTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.source=self.root/'original.png'
 def tearDown(self):self.tmp.cleanup()
 def save(self,mode,size,raw=None):
  image=Image.frombytes(mode,size,raw) if raw else Image.new(mode,size,(120,80,50,90) if mode=='RGBA' else (120,80,50))
  image.save(self.source,'PNG');return self.source.read_bytes()
 def test_small_image_is_bit_identical(self):
  raw=self.save('RGB',(32,48));r=prepare_upload(self.root,'asset',self.source)
  self.assertFalse(r['upload']['prepared']);self.assertEqual(base64.b64decode(r['base64']),raw);self.assertEqual(Path(r['local_path']),self.source)
 def test_6mb_png_is_prepared_with_base64_below_8mb(self):
  raw=self.save('RGB',(1450,1450),random.Random(7).randbytes(1450*1450*3));self.assertGreater(encoded_size(len(raw)),8_000_000);self.assertLess(len(raw),8_000_000)
  r=prepare_upload(self.root,'asset',self.source,8_000_000);self.assertTrue(r['upload']['prepared']);self.assertLessEqual(len(r['base64']),8_000_000)
  self.assertEqual(r['upload']['dimensions'],[1450,1450]);self.assertEqual(self.source.read_bytes(),raw)
  p=Path(r['local_path']);self.assertEqual(p.suffix,'.jpg');self.assertEqual(p.read_bytes(),base64.b64decode(r['base64']))
 def test_custom_limit_and_transparency_preserved(self):
  self.save('RGBA',(96,96),random.Random(8).randbytes(96*96*4));r=prepare_upload(self.root,'asset',self.source,10_000)
  self.assertLessEqual(len(r['base64']),10_000);self.assertTrue(r['upload']['prepared']);self.assertEqual(r['upload']['format'],'PNG')
  with Image.open(r['local_path']) as im:self.assertIn('A',im.getbands())
 def test_exif_orientation_is_applied_when_converting(self):
  im=Image.frombytes('RGB',(120,80),random.Random(4).randbytes(120*80*3));exif=Image.Exif();exif[274]=6;im.save(self.source,format='PNG',exif=exif)
  r=prepare_upload(self.root,'asset',self.source,30_000);self.assertEqual(r['upload']['dimensions'],[80,120])
 def test_invalid_limits_fail_without_copy(self):
  self.save('RGB',(32,48))
  for limit in [0,True,'8000000',32_000_001]:
   with self.assertRaises(ValueError):prepare_upload(self.root,'asset',self.source,limit)
 def test_generated_copy_is_removed_with_asset_purge(self):
  from server import App
  app=App(self.root/'store');app.stop.set()
  try:
   pid=app.store.put_project('purge uploads',{})['id'];raw=self.save('RGB',(128,128),random.Random(2).randbytes(128*128*3))
   a=app.upload('reference','source',base64.b64encode(raw).decode(),pid)
   prepared=prepare_upload(app.store.root,a['id'],app.store.root/a['local'],20_000);path=Path(prepared['local_path']);self.assertTrue(path.exists())
   app.store.asset_action(pid,[a['id']],{'trashed':True})
   plan=app.store.purge_plan(pid,[a['id']]);app.store.purge_assets(pid,[a['id']],plan['token']);self.assertFalse(path.exists())
  finally:app.bridge.close();app.store.db.close()
if __name__=='__main__':unittest.main()
