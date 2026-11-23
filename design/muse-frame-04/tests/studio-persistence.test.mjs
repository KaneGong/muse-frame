import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceWriter} from '../beta-client.mjs';
import {changes, packImages, sharedDocument, snapshot, windowView} from '../workspace-patch.mjs';
import {draftStore} from '../workspace-recovery.mjs';

const document=()=>({patchVersion:1,workspaceId:'isolated',revision:1,ui:{customDrafts:{}},
  state:{shoots:[{id:'one',title:'First'},{id:'two',title:'Second'}],currentShoot:'one',outputs:[
    {id:'history',prompt:'x'.repeat(1_000_000)}]}});
const store=()=>({values:new Map(),setItem(k,v){this.values.set(k,v);},getItem(k){return this.values.get(k)??null;}});

test('typing sends only changed fields, keeps request order and reports success after acknowledgement', async t=>{
  const oldFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=oldFetch;});
  const ws=document(), sent=[], states=[], releases=[];
  globalThis.fetch=async(url,{body})=>{
    sent.push(JSON.parse(body));
    await new Promise(resolve=>releases.push(resolve));
    return Response.json({revision:1+sent.length,media:[]});
  };
  const writer=workspaceWriter(ws,label=>states.push(label));
  const state=ws.state;
  state.shoots[1].title='A';
  const first=writer.save(state,ws.ui);
  state.shoots[1].title='AB';
  const second=writer.save(state,ws.ui);
  await new Promise(setImmediate);
  assert.equal(sent.length,1);
  assert.ok(JSON.stringify(sent[0]).length<200);
  assert.deepEqual(sent[0].patch,[{path:['state','shoots',{id:'two'},'title'],before:'Second',after:'A'}]);
  assert.ok(!states.some(label=>label.includes('✓')));
  releases.shift()(); await first; await new Promise(setImmediate);
  assert.equal(sent[1].patch[0].before,'A'); assert.equal(sent[1].patch[0].after,'AB');
  releases.shift()(); await second; await writer.confirm();
  assert.ok(states.at(-1).includes('✓')); assert.equal(writer.revision,3);
  state.currentShoot='two';
  await writer.save(state,{...ws.ui,shotId:'another'});
  assert.equal(sent.length,2);
});

test('a concurrent conflict retains original and edited values across browser storage instances',async t=>{
  const oldFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=oldFetch;});
  const fakeLocal={
    setItem(k,v){this[k]=v;}, getItem(k){return this[k]??null;}, removeItem(k){delete this[k];},
  };
  const browser={localStorage:fakeLocal}, ws=document();
  const drafts=draftStore(ws.workspaceId,browser);
  globalThis.fetch=async()=>Response.json({error:'conflict',code:'workspace_conflict'},{status:409});
  const writer=workspaceWriter(ws,()=>{},{drafts});
  ws.state.shoots[0].title='My draft';
  await assert.rejects(writer.save(ws.state,ws.ui));
  await writer.settled();
  const [record]=await draftStore(ws.workspaceId,browser).list();
  assert.equal(record.request.patch[0].before,'First'); assert.equal(record.request.patch[0].after,'My draft');
  assert.equal(writer.unsaved,true); assert.equal(writer.needsUnloadWarning,false);
  assert.deepEqual(await draftStore('different',browser).list(),[]);
});

test('per-window selection survives reload while images and historical references are deduplicated',()=>{
  const one=store(), two=store(), recent=store(), ws=document();
  const a=windowView(ws,one,recent), b=windowView(ws,two,recent);
  a.save({currentShoot:'one'},{shotId:'1'}); b.save({currentShoot:'two'},{shotId:'2'});
  assert.deepEqual(a.read(),{shotId:'1'}); assert.equal(ws.state.currentShoot,'one');
  assert.deepEqual(b.read(),{shotId:'2'}); assert.equal(ws.state.currentShoot,'two');
  const url='data:image/png;base64,AAAA', base=snapshot(sharedDocument(ws.state,ws.ui));
  ws.state.shoots[1].refs=[url,url];
  const current=snapshot(sharedDocument(ws.state,ws.ui),base);
  assert.equal(base.state.outputs,current.state.outputs);
  const delta=changes(base,current), request=packImages({patch:delta},new Map());
  assert.deepEqual(request.media,[url]); assert.deepEqual(request.patch[0].after,[{__mfImage:0},{__mfImage:0}]);
  const reused=packImages({patch:delta},new Map([[url,'/files/already-saved']]));
  assert.deepEqual(reused.media,[]); assert.equal(reused.patch[0].after[0],'/files/already-saved');
});
