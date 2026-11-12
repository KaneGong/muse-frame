import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import App
from store import Store

class ShotImportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.store=Store(self.tmp.name);self.addCleanup(self.store.db.close)
  self.app=App.__new__(App);self.app.store=self.store
  self.pid=self.store.put_project('roundtrip',{})['id']
  for aid,role in [('f','face'),('o','outfit'),('p1','pose'),('p2','pose')]:self.store.put_asset({'id':aid,'name':aid,'role':role,'source':'uploaded'},self.pid)
  data={'refs':{'face':'f','outfit':'o','pose':'p1'},'shots':[{'id':'s1','poseAsset':'p1','prompt':'first'},{'id':'s2','poseAsset':'p2','prompt':'second'}],
   'promptSpec':{'version':2,'project':{'fields':{}},'activeShot':'s1','shots':[{'id':'s1','fields':{},'mode':'manual','manualText':'Use image 4 for pose.','reviewedReferences':'old signature','pose':{'source':'reference','assetId':'p1'}},{'id':'s2','fields':{},'pose':{'source':'reference','assetId':'p2'}}]}}
  self.store.put_project('roundtrip',data,self.pid)
 def test_export_import_remaps_both_pose_representations_and_invalidates_manual_review(self):
  result=self.app.import_project(self.app.export_project(self.pid));d=result['data']
  ids={a['name']:a['id'] for a in self.store.assets(result['id'])}
  self.assertEqual([s['poseAsset'] for s in d['shots']],[ids['p1'],ids['p2']])
  self.assertEqual([s['pose']['assetId'] for s in d['promptSpec']['shots']],[ids['p1'],ids['p2']])
  self.assertEqual(d['promptSpec']['shots'][0]['manualText'],'Use image 4 for pose.')
  self.assertFalse(d['promptSpec']['shots'][0].get('reviewedReferences'))
 def test_invalid_per_shot_reference_is_rejected_before_import_creates_data(self):
  packet=self.app.export_project(self.pid);packet['project']['data']['promptSpec']['shots'][1]['pose']['assetId']='missing'
  before=len(self.store.projects())
  with self.assertRaises(ValueError):self.app.import_project(packet)
  self.assertEqual(len(self.store.projects()),before)
