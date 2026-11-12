import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outputChoices} from '../beta-generation.mjs';

const schema = props => ({properties:Object.fromEntries(
  Object.entries(props).map(([key,values])=>[key,{enum:values}])
)});

test('native ratios and clarity values keep platform casing and reject stale choices',()=>{
  const flux = schema({aspect_ratio:['3:4','1:1'],resolution:['auto','1k','2k','4k']});
  const pro = schema({aspect_ratio:['auto','16:9','9:21'],resolution:['1K','2K','4K']});
  const draft = {ratio:'3:4',resolution:'4k'};
  assert.deepEqual(outputChoices(flux,draft).settings,{...draft,size:null});
  assert.deepEqual(outputChoices(pro,draft).settings,{ratio:'default',resolution:'default',size:null});
  assert.deepEqual(outputChoices(pro).ratios,['auto','16:9','9:21']);
});

test('fixed pixel dimensions only offer sizes of the selected ratio',()=>{
  const sizes = schema({size:['auto','1024*1024','1536*2048','3072*4096']});
  const portrait = outputChoices(sizes,{ratio:'3:4',size:'1024*1024'});
  assert.deepEqual(portrait.clarity,['1536*2048','3072*4096']);
  assert.deepEqual(portrait.settings,{ratio:'3:4',resolution:'default',size:'1536*2048'});
  assert.deepEqual(outputChoices(sizes,{size:'3072*4096'}).settings,
    {ratio:'3:4',resolution:'default',size:'3072*4096'});
});
