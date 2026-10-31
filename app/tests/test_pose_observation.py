import unittest,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from pose_observation import parse_observation,GROUPS

def sample():
    parts={k:{'description':'侧坐在高窗台边缘。' if k=='support' else '可见走向，局部被遮挡。'} for k in GROUPS}
    for k in parts:
        if k.startswith(('arm_','leg_')):parts[k]['contact']={'state':'unknown','target':''}
    return {'summary':'侧坐在窗台边缘，一腿下伸，另一腿屈膝向侧方，小腿折回。','observations':parts,'uncertainties':['弯曲腿的脚部接触无法确认']}
class PoseObservationTests(unittest.TestCase):
    def test_unknown_is_retained_without_inventing_contact(self):
        r=parse_observation(json.dumps(sample()));self.assertEqual(r['observations']['leg_front']['contact']['state'],'unknown');self.assertTrue(r['warnings']);self.assertNotIn('踩',r['summary'])
    def test_missing_limb_rejected(self):
        s=sample();del s['observations']['leg_back']
        with self.assertRaises(ValueError):parse_observation(s)
    def test_uncertain_target_cannot_be_certain_contact(self):
        s=sample();s['observations']['leg_front']['contact']={'state':'touching','target':'无法确定的台面'}
        with self.assertRaises(ValueError):parse_observation(s)
    def test_touching_without_object_is_downgraded_to_unknown(self):
        s=sample();s['observations']['leg_front']['contact']={'state':'touching','target':''}
        r=parse_observation(s)
        self.assertEqual(r['observations']['leg_front']['contact']['state'],'unknown')
        self.assertTrue(any('未写明对象' in w for w in r['warnings']))
    def test_not_touching_needs_no_object(self):
        s=sample();s['observations']['arm_image_right']['contact']={'state':'not_touching','target':''}
        r=parse_observation(s)
        self.assertEqual(r['observations']['arm_image_right']['contact']['state'],'not_touching')
        self.assertFalse(any('arm_image_right' in w for w in r['warnings']))
    def test_plain_text_or_no_person_does_not_become_structured_success(self):
        for s in ['普通文字',{'error':'未识别到人物'}]:
            with self.assertRaises(ValueError):parse_observation(s)
    def test_conflicting_foot_states_are_rejected(self):
        s=sample();s['summary']='双脚落地，双脚悬空。'
        with self.assertRaises(ValueError):parse_observation(s)

def anchored():
    s=sample()
    s['anchors']=[{'id':'a1','type':'水平座面','at':'身后','height':'略高于臀部'},{'id':'a2','type':'地面','at':'身下'}]
    s['observations']['support']={'description':'坐在地面上，背部下段抵在身后座面前缘。','anchor':'a1'}
    for k in ('leg_front','leg_back'):
        s['observations'][k]['contact']={'state':'touching','target':'地面','anchor':'a2'}
    s['summary']='坐在地面上，臀部落地，上身后仰，背部下段抵在身后略高于臀部的水平座面前缘，双腿一伸一屈，双脚落在地面。'
    return s

class PoseAnchorTests(unittest.TestCase):
    def test_anchor_binding_upgrades_format(self):
        r=parse_observation(anchored());self.assertEqual(r['format'],'pose_observation_v1.1');self.assertEqual([a['id'] for a in r['anchors']],['a1','a2'])
    def test_legacy_without_anchors_still_supported(self):
        r=parse_observation(sample());self.assertEqual(r['format'],'pose_observation_v1');self.assertTrue(any('锚点' in w for w in r['warnings']))
    def test_decoration_words_stripped_in_summary(self):
        s=anchored();s['summary']='人物靠在沙发上，臀部落地，双脚踩地面。'
        r=parse_observation(s)
        self.assertNotIn('沙发',r['summary']);self.assertIn('座面',r['summary'])
        self.assertTrue(any('家具/材质' in w for w in r['warnings']))
    def test_structural_words_allowed_in_summary(self):
        parse_observation(anchored())
    def test_markdown_summary_rejected(self):
        s=anchored();s['summary']='## 动作\n'+s['summary']
        with self.assertRaises(ValueError):parse_observation(s)
    def test_anchor_type_material_is_stripped(self):
        s=anchored();s['anchors'][1]['type']='碎花座面'
        r=parse_observation(s);self.assertEqual(r['anchors'][1]['type'],'座面')
    def test_unknown_anchor_reference_rejected(self):
        s=anchored();s['observations']['leg_front']['contact']['anchor']='a9'
        with self.assertRaises(ValueError):parse_observation(s)
    def test_support_must_reference_anchor(self):
        s=anchored();del s['observations']['support']['anchor']
        with self.assertRaises(ValueError):parse_observation(s)
    def test_certain_leg_contact_must_reference_anchor(self):
        s=anchored();del s['observations']['leg_back']['contact']['anchor']
        with self.assertRaises(ValueError):parse_observation(s)
    def test_flat_feet_and_tiptoe_conflict_rejected(self):
        s=anchored();s['summary']='双脚平放在地面上，另一只脚脚尖点地。'
        with self.assertRaises(ValueError):parse_observation(s)
    def test_one_flat_one_tiptoe_is_allowed(self):
        s=anchored();s['summary']='臀部坐在地面，下方一只脚的脚背贴地，另一只脚的脚趾点在地面、脚跟离地。'
        parse_observation(s)
