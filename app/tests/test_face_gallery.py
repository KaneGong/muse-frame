import io,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import face_gallery
from server import App
from store import Store
class FaceGalleryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.app=App.__new__(App);self.app.store=Store(Path(self.tmp.name));self.p=self.app.store.put_project('one',{'refs':{}});self.p2=self.app.store.put_project('two',{'refs':{}})
  b=io.BytesIO();Image.new('RGB',(8,8),'red').save(b,'PNG');self.raw=b.getvalue()
 def test_import_is_project_scoped_and_deduplicated(self):
  source={'items':[{'id':'f1','section':'face'}]}
  with patch.object(face_gallery,'catalog',return_value=source),patch.object(face_gallery.urllib.request,'urlopen',side_effect=lambda *a,**kw:io.BytesIO(self.raw)):
   a=face_gallery.import_image(self.app,self.p['id'],'f1');b=face_gallery.import_image(self.app,self.p['id'],'f1');c=face_gallery.import_image(self.app,self.p2['id'],'f1')
  self.assertEqual(a['id'],b['id']);self.assertNotEqual(a['id'],c['id']);self.assertEqual(a['role'],'face')
 def test_rejects_unknown_or_unsafe_identifier(self):
  with patch.object(face_gallery,'catalog',return_value={'items':[]}):
   for cid in ('../etc','unknown'):
    with self.assertRaises(ValueError):face_gallery.import_image(self.app,self.p['id'],cid)
