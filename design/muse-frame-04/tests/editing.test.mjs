import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizedPoint,selectionRegion,uploadRatio} from '../ai-edit.mjs';
import {shotCandidates} from '../candidate-compare.mjs';
import {bagPrompt} from '../bag-options.mjs';
import {effectivePrompt} from '../model.mjs';

test('selection stays in image coordinates after zoom and reverse dragging',()=>{
  const a=normalizedPoint(400,500,{left:100,top:100,width:600,height:800});
  const b=normalizedPoint(100,100,{left:100,top:100,width:600,height:800});
  assert.deepEqual(selectionRegion(a,b),{x:0,y:0,width:.5,height:.5});
  assert.deepEqual(normalizedPoint(-20,3000,{left:100,top:100,width:600,height:800}),{x:0,y:1});
  assert.equal(selectionRegion(a,a),null);
});
test('candidate list includes edit versions and excludes other shots and trash',()=>{
  const target={id:'a',shootId:'s',shotId:'one',revision:1};
  const items=[target,{...target,id:'b',revision:2,parentId:'a'},{...target,id:'trash',trashed:true},{...target,id:'other',shotId:'two'},{...target,id:'foreign',shootId:'t'}];
  assert.deepEqual(shotCandidates(items,target).map(o=>o.id),['b','a']);
});
test('bag choices only affect the selected shot and leave handwritten prompts intact',()=>{
  const sh={shots:[],promptMode:'guided'},a={bagMode:'none'},b={};
  assert.ok(effectivePrompt(sh,a).includes('不携带'));
  assert.equal(effectivePrompt(sh,b),'');
  assert.equal(effectivePrompt({...sh,promptMode:'custom',customPrompt:'original'},a),'original');
  assert.equal(bagPrompt({bagMode:'auto'}),'');
  assert.ok(bagPrompt({bagMode:'hand',bagSide:'right'}).includes('人物自身右侧'));
});

test('uploaded aspect ratio is chosen from the source rather than the previous shot',()=>{assert.equal(uploadRatio(1600,900),'16:9');assert.equal(uploadRatio(900,1200),'3:4');assert.equal(uploadRatio(1900,1111),'default');});
