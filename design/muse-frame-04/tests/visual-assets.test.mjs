import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PLANS,SPACES,FRAMINGS} from '../creative-data.mjs';
import {PLAN_VISUALS,SPACE_VISUALS} from '../visual-assets.mjs';
import {FRAMING_VISUALS} from '../framing-visuals.mjs';

test('all 12 framing choices have distinct, shipped full and thumbnail photographs',()=>{
  assert.deepEqual(Object.keys(FRAMING_VISUALS).sort(),FRAMINGS.map(item=>item.id).sort());
  const hashes=new Set();
  for(const visual of Object.values(FRAMING_VISUALS)){
    assert.equal(visual.label,'AI取景示例');
    assert.ok(visual.alt.includes('取景示例'));
    assert.notEqual(visual.src,visual.thumb);
    for(const file of [visual.src,visual.thumb]){
      const bytes=readFileSync(new URL('../'+file,import.meta.url));
      assert.equal(bytes.toString('ascii',0,4),'RIFF');
      assert.equal(bytes.toString('ascii',8,12),'WEBP');
      assert.ok(bytes.length>1000);
      const content=bytes.toString('base64');
      assert.ok(!hashes.has(content),'Each choice and preview needs its own image');
      hashes.add(content);
    }
  }
});

test('every shipped visual binds a real plan or exact background variant and decodes as WebP',()=>{
  assert.deepEqual(Object.keys(PLAN_VISUALS).sort(),PLANS.map(p=>p.id).sort());
  assert.deepEqual(Object.keys(SPACE_VISUALS).sort(),SPACES.flatMap(s=>s.variants.map(v=>`${s.id}.${v.id}`)).sort());
  const fullPaths=new Set();
  for(const [kind,entries] of [['plan',PLAN_VISUALS],['space',SPACE_VISUALS]]){
    for(const [id,visual] of Object.entries(entries)){
      if(kind==='plan')assert.ok(PLANS.some(p=>p.id===id),id);
      else{const [space,variant]=id.split('.');assert.ok(SPACES.find(s=>s.id===space)?.variants.some(v=>v.id===variant),id);}
      assert.ok(visual.alt && visual.label.startsWith('AI'));
      assert.ok(!fullPaths.has(visual.src),'No unrelated preset shares an example photo');
      fullPaths.add(visual.src);
      for(const file of [visual.src,visual.thumb]){
        assert.match(file,/^assets\/generated\/[a-z0-9-]+\.webp$/);
        const bytes=readFileSync(new URL('../'+file,import.meta.url));
        assert.equal(bytes.toString('ascii',0,4),'RIFF');
        assert.equal(bytes.toString('ascii',8,12),'WEBP');
        assert.ok(bytes.length>1000);
      }
      assert.notEqual(visual.src,visual.thumb);
    }
  }
});
