import test from 'node:test';
import assert from 'node:assert/strict';
import {readAgentPlan,createPlannedShoot} from '../agent-plan.mjs';
import {freshState} from '../model.mjs';

test('an agent plan creates independent local shots with no attached identities or jobs',()=>{
  const state=freshState(), original=structuredClone(state.shoots), jobs=state.tasks.length;
  state.defaultBodyAssetId=state.assets[0].id;
  const raw={format:'muse-frame.plan/v1', title:'Window', brief:'Evening', model:'previous',
    shots:[{title:'A',direction:'side light'},{title:'B',direction:'profile'}]};
  const shoot=createPlannedShoot(state,readAgentPlan(JSON.stringify(raw)));
  assert.equal(shoot.model,null);assert.equal(shoot.outfit,null);assert.deepEqual(shoot.refs,[]);
  assert.deepEqual(state.shoots.slice(0,-1),original);assert.equal(state.tasks.length,jobs);
  assert.deepEqual(shoot.shots.map(s=>s.note),['side light','profile']);
  assert.equal(new Set(shoot.shots.map(s=>s.id)).size,2);
  for(const value of [null,{...raw,format:'v2'},{...raw,shots:[]},{...raw,shots:Array(13).fill(raw.shots[0])},
    {...raw,shots:[{title:'X',direction:false}]},{...raw,title:'x'.repeat(101)}])
    assert.throws(()=>readAgentPlan(JSON.stringify(value)));
});

test('paste accepts one complete fenced JSON plan and rejects surrounding prose', () => {
  const body = JSON.stringify({format:'muse-frame.plan/v1',title:'Studio',shots:[{title:'Close-up',direction:'Soft window light'}]});
  const fence = '`'.repeat(3);
  const pasted = [fence+'json',body,fence].join('\r\n');
  assert.deepEqual(readAgentPlan(pasted),readAgentPlan(body));
  assert.throws(() => readAgentPlan('my note\n'+pasted));
  assert.throws(() => readAgentPlan(pasted+'\n'+pasted));
});
