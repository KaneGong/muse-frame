import copy,hashlib,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_beta_integration as fixture
from beta_store import save_workspace,read_workspace,WORKSPACE_ID
from beta_shoots import delete_shoot,install_body_template
from beta_prompt import compile_prompt

class UsabilityTests(unittest.TestCase):
    setUp=fixture.IntegrationTests.setUp
    tearDown=fixture.IntegrationTests.tearDown

    def persist(self,state):
        return save_workspace(self.app,{'revision':read_workspace(self.app.store)['revision'],'state':state,'ui':{},'media':[]})

    def two_shoots(self):
        state=read_workspace(self.app.store)['state']
        state['shoots'].append({'id':'shoot-two','title':'保留','purpose':'social','shots':[],'refs':[{'assetId':'own-body','role':'身形'}]})
        state['currentShoot']='shoot-one';self.persist(state)
        return state

    def test_template_identity_role_and_explicit_removal_survive(self):
        self.two_shoots();root=self.app.store.root
        (root/'defaults').mkdir();(root/'defaults/body.jpg').write_bytes(fixture.IMAGE)
        install_body_template(self.app)
        workspace=read_workspace(self.app.store);state=workspace['state'];aid=state['defaultBodyAssetId']
        self.assertEqual(state['shoots'][0]['model'],'face')
        self.assertEqual(state['shoots'][0]['refs'],[{'assetId':aid,'role':'身形'}])
        self.assertEqual(state['shoots'][1]['refs'][0]['assetId'],'own-body')
        self.assertTrue(self.app.store.project_media_path(WORKSPACE_ID,'assets/'+aid+'.jpg').is_file())
        state['shoots'][0]['refs']=[];self.persist(state);install_body_template(self.app)
        self.assertEqual(read_workspace(self.app.store)['state']['shoots'][0]['refs'],[])

    def test_delete_scoped_cache_and_keep_original_shared_receipt(self):
        self.two_shoots();store=self.app.store;pid='design-'+hashlib.sha256(b'shoot-one').hexdigest()[:32]
        store.put_project('fixture',{},pid);store.put_project('other',{},'other')
        (store.root/'thumbs').mkdir(exist_ok=True)
        paths=[]
        for name in ('own','shared'):
            f=store.root/'assets'/f'{name}.webp';f.write_bytes(fixture.IMAGE)
            store.put_asset({'id':name,'name':name,'role':'source','local':f'assets/{name}.webp'},pid)
            if name=='shared':store.put_asset({'id':name},'other')
            key=hashlib.sha1(f'{f.resolve()}|{f.stat().st_mtime_ns}|360'.encode()).hexdigest()+'.jpg'
            thumb=store.root/'thumbs'/key;thumb.write_bytes(b'cache');paths.append((f,thumb))
        receipt=store.root/'receipt.json';receipt.write_text('{}')
        result=delete_shoot(self.app,{'shootId':'shoot-one','clearCache':True,'revision':read_workspace(store)['revision']})
        self.assertEqual(result['cleared'],1)
        self.assertFalse(paths[0][1].exists());self.assertTrue(paths[1][1].exists())
        self.assertTrue(all(f.is_file() for f,t in paths));self.assertTrue(receipt.is_file())
        state=read_workspace(store)['state'];self.assertTrue(state['shoots'][0]['archived']);self.assertEqual(state['currentShoot'],'shoot-two')
        state['shoots'][0]['archived']=False;self.persist(state)
        self.assertFalse(read_workspace(store)['state']['shoots'][0]['archived'])

    def test_pending_and_stale_delete_blocked(self):
        state=self.two_shoots();state['tasks']=[{'shootId':'shoot-one','state':'unknown'}];self.persist(state)
        with self.assertRaisesRegex(ValueError,'待确认'):delete_shoot(self.app,{'shootId':'shoot-one','revision':read_workspace(self.app.store)['revision']})
        with self.assertRaisesRegex(ValueError,'已变化'):delete_shoot(self.app,{'shootId':'shoot-one','revision':0})
        self.assertFalse(read_workspace(self.app.store)['state']['shoots'][0].get('archived'))

    def test_tone_camera_and_body_reach_same_canonical_prompt(self):
        shot={'options':{'angle':{'source':'catalog','value':'相机贴近地面向上拍摄'},'color':{'source':'catalog','value':'沉静低调；不更换场景光源方向'},'contrast':{'source':'style','value':'旧风格高调反差'}}}
        text,fields=compile_prompt({},shot,{'face':'f','body':'b','outfit':'o','scene':'s','pose':'p'},None)
        self.assertIn('图2',text);self.assertIn('图3中的服装',text);self.assertIn('贴近地面',text);self.assertIn('沉静低调',text)
        self.assertNotIn('旧风格高调反差',text);self.assertEqual(fields['contrast'],'')
        shot['options']['contrast']['source']='custom'
        self.assertIn('旧风格高调反差',compile_prompt({},shot,{'face':'f','outfit':'o'},None)[0])

    def test_fused_presets_respect_effective_crop_and_hand_selected_contrast(self):
        refs = {'face': 'f', 'outfit': 'o', 'scene': 's', 'pose': 'p'}
        notes = {}
        shot = {'poseMode': 'strict', 'options': {
            'shot': {'source': 'preset', 'value': '腰部以上半身取景'},
            'scale': {'source': 'quick', 'value': '人物占画面主要高度，头顶与脚下留适量边距'},
            'color': {'source': 'catalog', 'value': '沉静低调，压低整体亮度，人物和衣料暗部仍清晰，不死黑；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。'},
            'contrast': {'source': 'preset', 'value': '高调低反差，大面积亮白但不丢失细节'},
            'prop': {'source': 'catalog', 'value': '本张需要一张简洁无靠背坐凳，姿态与凳面、脚部接触可信；应与整组环境匹配'},
        }}
        prompt, fields = compile_prompt({}, shot, refs, None, notes=notes)
        self.assertIn('景别：腰部以上半身取景', prompt)
        self.assertIn('可见主体约占画面高度的85%', fields['scale'])
        self.assertNotIn('头顶到鞋底', prompt)
        self.assertNotIn('压低整体亮度', prompt)
        self.assertIn(fields['contrast'], prompt)
        self.assertIn('色彩表现', notes['color'])
        self.assertIn('场景中已有的合适坐凳', fields['prop'])
        self.assertIn('只用空闲手', prompt)
        self.assertIn('尽量还原站坐姿态、关节角度、重心与接触点', prompt)
        shot['poseMode'] = 'adaptive'
        self.assertIn('自然微调局部角度和落点', compile_prompt({}, shot, refs, None)[0])
        shot['options']['scale'] = {'source': 'preset', 'value': '人物在画面中占比较小，展示周围环境'}
        self.assertIn('可见主体保留较小比例', compile_prompt({}, shot, refs, None)[1]['scale'])

if __name__=='__main__':unittest.main()
