import base64
import hashlib
import io
import unittest
from PIL import Image
import test_beta_integration as fixtures
ENCODED = fixtures.ENCODED
from beta_edit import validate_region, scoped_source
from beta_bag import bag_prompt
from beta_jobs import enqueue_shots, read_reference
from beta_prompt import compile_prompt, option_rows
from beta_store import read_workspace, save_workspace


class EditingTests(unittest.TestCase):
    setUp = fixtures.IntegrationTests.setUp
    tearDown = fixtures.IntegrationTests.tearDown

    def upload_source(self):
        workspace = read_workspace(self.app.store)
        self.state = workspace['state']
        self.state['shoots'][0].update(editingOnly=True, model=None, outfit=None)
        self.state['outputs'].append({'id':'uploaded-test','shootId':'shoot-one','shotId':'shot-one',
                                      'title':'原图','image':self.state['assets'][0]['image'],'uploaded':True,'revision':1})
        saved=save_workspace(self.app,{'revision':workspace['revision'],'state':self.state,'ui':{}})
        self.request.update(revision=saved['revision'],editOutput='uploaded-test')
        self.request['shots'][0]['prompt']='只修复右手'

    def test_uploaded_edit_preview_and_submission_have_identical_references(self):
        self.upload_source()
        self.request['edit']={'region':{'x':.2,'y':.3,'width':.15,'height':.2},
                              'references':[{'name':'服装细节','image':self.state['assets'][0]['image']}]}
        review=enqueue_shots(self.app,self.request,review=True)
        row=review['shots'][0]
        self.assertTrue(row['editing'])
        self.assertEqual(len(row['references']),3)
        self.assertIn('图2是同一原图的定位副本',row['prompt'])
        self.assertIn('图3为补充参考',row['prompt'])
        ids=[ref['assetId'] for ref in row['references']]
        self.assertNotEqual(ids[0],ids[1])
        pid='design-'+hashlib.sha256(b'shoot-one').hexdigest()[:32]
        raw=base64.b64decode(read_reference(self.app.store,self.app.store.asset(ids[0],pid)['preview']))
        self.assertEqual(hashlib.sha256(raw).hexdigest(),hashlib.sha256(base64.b64decode(ENCODED)).hexdigest())
        marked=base64.b64decode(read_reference(self.app.store,self.app.store.asset(ids[1],pid)['preview']))
        with Image.open(io.BytesIO(marked)) as image:
            self.assertLessEqual(max(image.size),2048)
            r,g,b=image.getpixel((round(image.width*.2),round(image.height*.35)))[:3]
            self.assertGreater(r,g*1.5)
        repeat=enqueue_shots(self.app,self.request,review=True)
        self.assertEqual(review['reviewToken'],repeat['reviewToken'])
        result=enqueue_shots(self.app,{**self.request,'reviewToken':review['reviewToken']})
        job=self.app.store.jobs(pid)[0]
        self.assertEqual(job['payload']['refs'],ids)
        self.assertEqual(job['payload']['prompt'],row['prompt'])
        self.assertEqual(job['payload']['design']['parentOutputId'],'uploaded-test')
        self.assertEqual(enqueue_shots(self.app,{**self.request,'reviewToken':review['reviewToken']})['accepted'],1)

    def test_unselected_edit_keeps_plain_prompt_and_single_source(self):
        self.upload_source()
        row=enqueue_shots(self.app,self.request,review=True)['shots'][0]
        self.assertEqual(row['prompt'],'只修复右手')
        self.assertEqual(len(row['references']),1)

    def test_invalid_edit_does_not_register_job(self):
        self.upload_source()
        for edit in ({'region':{'x':.9,'y':0,'width':.5,'height':.1}},
                     {'references':[{'name':'x','image':self.state['assets'][0]['image']}]*3},
                     {'references':[{'name':'x','image':'/files/assets/x.png?project_id=other'}]}):
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                enqueue_shots(self.app,{**self.request,'edit':edit},review=True)
        self.assertEqual(self.app.store.db.execute('SELECT count(*) FROM jobs').fetchone()[0],0)

    def test_wrong_shot_and_trashed_original_are_rejected(self):
        self.upload_source()
        workspace=read_workspace(self.app.store)
        workspace['state']['outputs'][0]['trashed']=True
        saved=save_workspace(self.app,{'revision':workspace['revision'],'state':workspace['state'],'ui':{}})
        self.request['revision']=saved['revision']
        with self.assertRaisesRegex(ValueError,'回收站'):
            enqueue_shots(self.app,self.request,review=True)
        with self.assertRaises(ValueError):
            enqueue_shots(self.app,{**self.request,'editOutput':'not-in-shot'},review=True)

    def test_bag_modes_preserve_legacy_default_and_avoid_conflicting_placement(self):
        shoot=self.state['shoots'][0];shot=shoot['shots'][0];refs={'face':'f','outfit':'o'}
        original=compile_prompt(shoot,shot,refs,None)
        self.assertEqual(original,compile_prompt(shoot,{**shot,'bagMode':'auto'},refs,None))
        for mode in ['reference','shoulder','hand','ground','none']:
            selected={**shot,'bagMode':mode,'bagSide':'left'}
            prompt,_=compile_prompt(shoot,selected,refs,None)
            self.assertIn(bag_prompt(selected),prompt)
            self.assertNotIn('包等配饰保留',prompt)
            self.assertNotIn('随姿态和场景自然佩戴、携带或落放',prompt)
        with self.assertRaises(ValueError):
            compile_prompt(shoot,{**shot,'bagMode':'invalid'},refs,None)

    def test_model_capacity_and_changed_selection_require_new_review(self):
        self.upload_source()
        self.request['edit']={'region':{'x':.1,'y':.2,'width':.2,'height':.2},
                              'references':[{'name':'细节','image':self.state['assets'][0]['image']}]}
        self.app.catalog[0]['max_references']=2
        with self.assertRaisesRegex(ValueError,'最多接收 2'):
            enqueue_shots(self.app,self.request,review=True)
        self.app.catalog[0]['max_references']=4
        review=enqueue_shots(self.app,self.request,review=True)
        self.request['edit']['region']['x']=.2
        with self.assertRaisesRegex(ValueError,'重新核对'):
            enqueue_shots(self.app,{**self.request,'reviewToken':review['reviewToken']})
        self.assertEqual(self.app.store.db.execute('SELECT count(*) FROM jobs').fetchone()[0],0)

    def test_coordinate_bounds_and_cross_project_references(self):
        for region in ({'x':True,'y':0,'width':.1,'height':.1},
                       {'x':float('nan'),'y':0,'width':.1,'height':.1},
                       {'x':0,'y':0,'width':0,'height':.1},
                       {'x':0,'y':0,'width':1.1,'height':.1}):
            with self.assertRaises(ValueError):validate_region(region)
        self.assertIsNone(validate_region(None))
        self.assertEqual(validate_region({'x':0,'y':0,'width':1,'height':1})['width'],1)
        with self.assertRaises(ValueError):scoped_source('/files/a.png?project_id=foreign','design-one')
