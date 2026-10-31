const test=require('node:test'),assert=require('node:assert/strict');const PE=require('../static/prompt-engine.js'),L=require('../static/library.json'),T=require('../static/templates.json');
test('every photography preset writes its own field without changing unrelated fields or the handwritten footer',()=>{
 const fields=L.groups.map(g=>g.id).filter(id=>id!=='ratio');const draft=T.portrait+'\n手写备注：保留衣领纹理，避免塑料皮肤。';let checked=0;
 for(const g of L.groups.filter(g=>g.id!=='ratio'))for(const o of g.options){
  const next=PE.patch(draft,g.id,o.prompt);assert.equal(PE.get(next,g.id),o.prompt,`${g.id}: ${o.name}`);assert.ok(next.split('\n').includes('手写备注：保留衣领纹理，避免塑料皮肤。'));
  for(const key of fields.filter(k=>k!==g.id))assert.equal(PE.get(next,key),PE.get(draft,key),`${g.id} modified ${key}`);checked++;
 }
 assert.equal(checked,82);
});
test('changing the model ratio keeps the visible prompt unchanged',()=>{
 for(const option of L.groups.find(g=>g.id==='ratio').options){const ratio=option.prompt.match(/\d+:\d+/)?.[0]||option.name.match(/\d+:\d+/)?.[0];assert.ok(ratio);const next=PE.ratio(T.portrait,ratio);assert.equal(next,T.portrait);}
});
