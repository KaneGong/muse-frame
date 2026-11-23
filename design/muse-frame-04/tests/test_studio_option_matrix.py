"""Regression contract for the shipped option catalogue and persisted Studio drafts."""
import itertools
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT.parents[1] / 'app')]
from beta_prompt import FIELDS, compile_prompt, option_rows
from studio_prompt import COVERAGE, coverage_for

REFS = dict(face='f', outfit='o', scene='s', pose='p')
STUDIO = {'promptVariant': 'studio-v2'}


def entry(value, source='preset'):
    return dict(source=source, value=value)


class CatalogueCombinations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(subprocess.check_output(['node', ROOT / 'tests/studio-catalog.mjs']))
        cls.options = cls.catalog['options']

    def check_render(self, selected, overrides=None):
        shoot = {**STUDIO, 'options': selected}
        shot = {'poseMode': 'strict', **(overrides or {})}
        notes = {}
        prompt, fields = compile_prompt(shoot, shot, REFS, None, notes=notes)
        rows = option_rows(shoot, shot, fields, notes)
        for row in rows:
            field = row['field']
            if field == 'bag':
                self.assertIn(row['value'], prompt)
                continue
            label = row['label'] + '：'
            lines = [line for line in prompt.splitlines() if line.startswith(label)]
            if fields[field]:
                self.assertEqual(lines, [label + row['value']])
            else:
                self.assertFalse(lines)
                self.assertTrue(row['note'] or row['mode'] == '不写入')
        self.assertIn('姿态只取图4', prompt)
        self.assertNotIn('侧坐', prompt)
        self.assertEqual('四条画边以内' in prompt, coverage_for(fields['shot']) == 'full')
        return prompt, fields, notes

    def test_every_pair_of_cross_field_catalogue_values(self):
        fields = {k for k, _ in FIELDS}
        self.assertEqual(set(self.options), fields | {'ratio', 'scene'})
        pairs = 0
        for a, b in itertools.combinations(sorted(fields), 2):
            for x, y in itertools.product(self.options[a], self.options[b]):
                try:
                    self.check_render({a:x, b:y})
                except AssertionError as error:
                    raise AssertionError((a, x, b, y)) from error
                pairs += 1
        print(f'Studio catalogue: {sum(len(self.options[k]) for k in fields)} distinct field values, {pairs} cross-field pairs.')

    def test_each_frame_scale_placement_and_card_bundles(self):
        frames = self.catalog['frames']
        count = 0
        for crop, scale, place in itertools.product(self.options['shot'], self.options['scale'], self.options['placement']):
            text, fields, _ = self.check_render({'shot':crop, 'scale':scale, 'placement':place})
            self.assertTrue(coverage_for(fields['shot']), crop)
            self.assertIn('画面位置：' + fields['placement'], text)
            self.assertTrue(fields['scale'])
            count += 1
        for fr, mood, exp in itertools.product(frames, self.catalog['moods'], self.catalog['expressions']):
            fields = {k:entry(v, 'quick') for c in (fr,mood,exp) for k,v in c['options'].items()}
            text, result, notes = self.check_render(fields)
            if notes['profile'].get('hidden'):
                self.assertFalse(result['gaze'] or result['expression'])
            count += 1
        print(f'Studio composition and bundle triples: {count}.')

    def test_all_local_options_with_visibility_and_bag_controls(self):
        lower = next(x for x in self.options['shot'] if '腰线附近' in x['value'])
        local = {'shot':lower, 'scale': entry('', 'cleared')}
        for key in ('expression','gaze','hair','makeup','skin','light','contrast','depth','angle','finish','color','prop','accessory','time','weather','placement','lens'):
            for option in self.options[key]:
                text, fields, notes = self.check_render(dict(local, **{key:option}))
                if key in ('expression','gaze','hair','makeup'):
                    self.assertFalse(fields[key])
                    self.assertIn('画外', notes[key])
                self.assertIn('只截取对应部分', text)
                self.assertNotIn('人物占比：', text)
                self.assertNotIn('保持脸型', text)
        for bag, side, prop in itertools.product(('auto','none','reference','hand','shoulder','ground'),
                ('auto','left','right'),self.options['prop']):
            _, fields, _ = self.check_render({'shot':lower,'prop':prop}, {'bagMode':bag,'bagSide':side})
            if prop['value'] in COVERAGE['bagProps']:
                self.assertEqual(bool(fields['prop']), bag == 'auto')

    def test_group_override_clear_restore_and_cross_field_precedence(self):
        opts={'shot':entry('腰部以上半身取景'), 'gaze':entry('双眼自然轻闭'), 'light':entry('宽大窗边散射光，面部阴影柔和')}
        lower=next(x for x in self.options['shot'] if '腰线附近' in x['value'])
        source=json.dumps(opts, ensure_ascii=False)
        _, projected, notes=self.check_render(opts, {'options':{'shot':lower}})
        self.assertFalse(projected['gaze'])
        self.assertEqual(notes['directionFields']['light'], opts['light']['value'])
        self.assertEqual(projected['light'],'宽大窗边散射光，主体阴影柔和')
        self.assertEqual(opts['light']['value'], self.check_render(opts)[1]['light'])
        self.assertEqual(json.dumps(opts, ensure_ascii=False),source)
        for value in self.options['color']:
            if '不更换场景光源方向' not in value['value']:continue
            for contrast in self.options['contrast'][:4]:
                text,fields,_=self.check_render({'color':value,'contrast':{**contrast,'source':'preset'}})
                self.assertEqual(fields['contrast'],contrast['value'])
                for other in ('高反差','中高反差','中低反差','中等反差','降低反差'):
                    self.assertNotIn(other,fields['color'])
        # Explicit user copy and an unrecognized crop retain their meaning.
        for key in ('light','time','color','angle','skin'):
            _, fields, _ = self.check_render({'shot':entry('我自己指定的裁切','custom'),key:entry('我写的面部光影','custom')})
            self.assertEqual(fields[key],'我写的面部光影')
