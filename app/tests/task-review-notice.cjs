const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('a reviewed notification stays visible until its platform task is resolved',()=>{
 const dom=new JSDOM('<div id="rail-task-status"><span id="rail-task-title"></span><span id="rail-task-detail"></span><div id="rail-task-projects"></div></div><nav id="nav"><button data-step="tasks"></button></nav><input id="completion-sound"><span id="sound-note"></span>',{runScripts:'outside-only'}),w=dom.window;
 w.Q={$:id=>w.document.getElementById(id),project:{id:'p'},esc:s=>s,run:f=>f,meta:{task_summary:{projects:[{id:'p',name:'Project',active:0,paused:0,completed:0,attention:0,review:1}]}}};w.eval(fs.readFileSync('app/static/task-notices.js','utf8'));w.Q.renderTaskRail();assert.match(w.document.getElementById('rail-task-title').textContent,/待核对/);assert.match(w.document.querySelector('[data-step="tasks"]').textContent,/待核对/);dom.window.close();
});
test('empty task notifications stay hidden and return for each meaningful state',()=>{
 const dom=new JSDOM('<div id="rail-task-status"><span id="rail-task-title"></span><span id="rail-task-detail"></span><div id="rail-task-projects"></div></div><nav id="nav"></nav><input id="completion-sound"><span id="sound-note"></span>',{runScripts:'outside-only'}),w=dom.window;
 try{
  w.Q={$:id=>w.document.getElementById(id),esc:s=>s,run:f=>f,meta:{task_summary:{projects:[]}}};
  w.eval(fs.readFileSync('app/static/task-notices.js','utf8'));const q=w.Q,box=q.$('rail-task-status');
  q.renderTaskRail();assert.equal(box.hidden,true);
  for(const field of ['active','completed','attention','review','paused']){
   q.meta.task_summary.projects=[{id:'other',name:'Other project',active:0,completed:0,attention:0,review:0,paused:0,[field]:1}];
   q.renderTaskRail();assert.equal(box.hidden,false,field);assert.match(box.textContent,/Other project/);
   q.meta.task_summary.projects=[];q.renderTaskRail();assert.equal(box.hidden,true);
  }
 }finally{w.close();}
});
