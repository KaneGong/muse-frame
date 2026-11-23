import {getLanguage} from './language.mjs';
import {readPath} from './workspace-patch.mjs';

const copy = (zh,en)=>getLanguage()==='en' ? en : zh;
const storeName='drafts';
export function draftStore(workspaceId, browser = window) {
  const prefix='muse-frame-conflict:'+workspaceId+':';
  const memory=new Map();
  let opening;
  function database() {
    if (!opening) opening=new Promise((resolve,reject)=>{
      const req=browser.indexedDB.open('muse-frame-conflict-drafts',1);
      req.onupgradeneeded=()=>req.result.createObjectStore(storeName,{keyPath:'id'}).createIndex('workspaceId','workspaceId');
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    return opening;
  }
  async function transact(mode,operation) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,mode);
      const request=operation(tx.objectStore(storeName));
      tx.oncomplete=()=>resolve(request.result);
      tx.onerror=tx.onabort=()=>reject(tx.error);
    });
  }
  return {
    async put(draft) {
      memory.set(draft.id,draft);
      try { await transact('readwrite',store=>store.put(draft)); browser.localStorage.removeItem(prefix+draft.id); return true; }
      catch {
        try { browser.localStorage.setItem(prefix+draft.id,JSON.stringify(draft)); return true; }
        catch { return false; }
      }
    },
    async list() {
      const records=new Map();
      try {
        const rows=await transact('readonly',store=>store.index('workspaceId').getAll(workspaceId));
        rows.forEach(row=>records.set(row.id,row));
      } catch {}
      try {
        for (const key of Object.keys(browser.localStorage).filter(key=>key.startsWith(prefix))) {
          const row=JSON.parse(browser.localStorage.getItem(key));
          if (!records.has(row.id) || records.get(row.id).updated<row.updated) records.set(row.id,row);
        }
      } catch {}
      for (const [key,row] of memory) if (!records.has(key) || records.get(key).updated<=row.updated) records.set(key,row);
      return [...records.values()].sort((a,b)=>b.updated-a.updated);
    },
    async remove(id) {
      // Wait for the actual removal before reporting success or reloading.
      if (browser.indexedDB) await transact('readwrite',store=>store.delete(id)).catch(async error=>{
        if (!browser.localStorage.getItem(prefix+id) && !memory.has(id)) throw error;
      });
      browser.localStorage.removeItem(prefix+id);
      memory.delete(id);
    },
  };
}

const description = value=>{
  if (value===undefined) return copy('（无）','(absent)');
  if (typeof value==='string') return value;
  return JSON.stringify(value);
};

export function draftNotice({storage,writer,workspaceId,fetchWorkspace,apply,download,warn}) {
  let records=[], issue='', dialog;
  const button=(label,act)=>{
    const el=document.createElement('button');
    el.type='button'; el.className='btn small'; el.textContent=label; el.onclick=act;
    return el;
  };
  const notice=document.querySelector('#save-warning');
  function draw() {
    notice.replaceChildren();
    notice.hidden=!records.length&&!issue;
    if (issue) notice.append(document.createTextNode(issue+' '));
    if (records.length) {
      notice.append(button(copy('查看未合并草稿','Review unsaved drafts'),()=>review().catch(warn)));
    }
  }
  async function refresh(message='') {
    issue=message;
    records=await storage.list();
    draw();
  }
  async function review() {
    await writer().settled();
    records=await storage.list();
    if (!records.length) { draw(); return; }
    const list=[...records].sort((a,b)=>Number(b.id===writer().draftId)-Number(a.id===writer().draftId));
    const latest=await fetchWorkspace();
    if (latest.workspaceId!==workspaceId) throw Error(copy('工作区已切换，请重新打开。','Workspace changed. Reopen this page.'));
    dialog?.remove();
    dialog=document.createElement('dialog');
    dialog.className='medium';
    dialog.setAttribute('aria-label',copy('恢复草稿','Recover drafts'));
    const body=document.createElement('section');
    body.className='dialog-body'; dialog.append(body);
    const heading=document.createElement('h2'); heading.textContent=copy('恢复未保存的改动','Recover unsaved changes'); body.append(heading);
    const message=document.createElement('p'); message.setAttribute('role','status'); body.append(message);
    const run=fn=>async event=>{
      const control=event.currentTarget; control.disabled=true;
      try { await fn(); } catch(error) { message.textContent=error.message; } finally { control.disabled=false; }
    };
    for (const record of list) {
      const row=document.createElement('section');
      const title=document.createElement('h3');
      title.textContent=new Date(record.updated).toLocaleString(); row.append(title);
      const ops=record.request.patch;
      // Capture preconditions alongside the displayed values. Another edit made
      // while this dialog is open is still checked atomically by the server.
      const rebased=[];
      if (ops) for (const op of ops) {
        let actual=readPath(latest,op.path);
        if (op.order && Array.isArray(actual)) {
          const relevant=new Set(op.before);
          actual=actual.map(item=>item.id).filter(id=>relevant.has(id));
        }
        // A recovering request may itself add/remove rows before reordering.
        const {before,...next}=op;
        if (actual!==undefined) next.before=actual;
        rebased.push(next);
        const details=document.createElement('details'), summary=document.createElement('summary');
        summary.textContent=op.path.map(key=>typeof key==='object'?key.id:key).join(' › ');
        const local=document.createElement('p'),disk=document.createElement('p');
        local.textContent=copy('草稿　','Draft　')+description(op.after).slice(0,1600);
        disk.textContent=copy('磁盘　','Saved　')+description(actual).slice(0,1600);
        details.append(summary,local,disk); row.append(details);
      }
      row.append(button(copy('导出这份草稿','Export draft'),run(async()=>{
        await download(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),'MuseFrame-draft-'+record.id+'.json');
      })));
      if (ops) row.append(button(copy('采用上列草稿改动','Apply listed draft changes'),run(async()=>{
        await apply({...record.request,revision:latest.revision,patch:rebased});
        await finish(record);
      })));
      row.append(button(copy('放弃这份草稿','Discard this draft'),run(async()=>{ await finish(record); })));
      body.append(row);
    }
    body.append(button(copy('关闭','Close'),()=>dialog.close()));
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    document.body.append(dialog); dialog.showModal();
  }
  async function finish(record) {
    await storage.remove(record.id);
    writer().release(record.id);
    dialog.close();
    if (!writer().unsaved) window.location.reload();
    else await refresh();
  }
  return {refresh,show(message=''){issue=message;draw();}};
}
