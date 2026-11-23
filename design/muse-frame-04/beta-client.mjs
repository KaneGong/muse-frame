import {tr, getLanguage} from './language.mjs';
import {changes, packImages, sharedDocument, snapshot} from './workspace-patch.mjs';
export async function betaApi(path, payload) {
  const headers = {};
  const epoch = globalThis.document?.body?.dataset.workspaceEpoch;
  if (epoch) headers['X-Muse-Workspace'] = epoch;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const options = payload === undefined ? {headers} : {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };
  const response = await fetch('/api/' + path, options);
  const result = await response.json();
  if (!response.ok || result.error) {
    const error=Error(result.error || tr("本机服务请求失败"));
    error.code=result.code; error.status=response.status;
    throw error;
  }
  return result;
}

export function workspaceWriter(workspace, onStatus, {view, drafts, onDraft=()=>{}}={}) {
  const modern=workspace.patchVersion===1;
  const storedMedia=new Map();
  const draftId=globalThis.crypto.randomUUID();
  let revision=workspace.revision, pending=0, failure=null, hasDraft=false, durableDraft=false;
  let committed=workspace.state ? snapshot(sharedDocument(workspace.state,workspace.ui)) : null;
  let queued=committed, tail=Promise.resolve();

  return {
    draftId,
    get unsaved() { return pending>0 || Boolean(failure); },
    get needsUnloadWarning() { return pending>0 || Boolean(failure && !durableDraft); },
    get revision() { return revision; },
    settled() { return tail; },
    async confirm() { await tail; if (failure) throw failure; },
    release(id) { if (id===draftId) { failure=null; hasDraft=false; durableDraft=false; } },
    storedImage(value) { return storedMedia.get(value) || value; },
    save(state, ui) {
      const {gallery,dialog,...persist}=ui;
      const shootId=state.currentShoot;
      // Capture synchronously. The caller may mutate the live editor before
      // this queued transaction runs, especially during continuous typing.
      const next=snapshot(sharedDocument(state,persist),queued);
      queued=next;
      const full=modern && committed ? null : snapshot({state,ui:persist});
      const localView=modern ? {...persist,selected:persist.selected?.slice()} : null;
      pending++;
      onStatus(tr("正在保存到本机…"));
      const write=tail.then(async()=>{
        if (modern) view?.save({currentShoot:shootId},localView);
        const ops=modern && committed ? changes(committed,next) : null;
        if (ops?.length===0) { failure=null; }
        else {
          // Full snapshots bootstrap empty workspaces and serve older backends.
          const request=packImages(ops ? {revision,patch:ops} : {revision,...full},storedMedia);
          let saved;
          try { saved=await betaApi('design-workspace',request); }
          catch(error) {
            if (modern && (error.code==='workspace_conflict' || hasDraft) && drafts) {
              hasDraft=true;
              durableDraft=await drafts.put({format:'muse-frame-conflict-v1',workspaceId:workspace.workspaceId,
                id:draftId,updated:Date.now(),request});
              error.message=getLanguage()==='en'
                ? (durableDraft?'Changes conflict. A recovery draft is saved in this browser.':'Changes conflict. Export this draft before closing this window.')
                : (durableDraft?'同一内容已在其他窗口修改，草稿已保存在本浏览器。':'同一内容已在其他窗口修改，请在关闭本窗口前导出草稿。');
              await onDraft(error.message);
            }
            throw error;
          }
          revision=saved.revision;
          request.media.forEach((value,index)=>storedMedia.set(value,saved.media[index]));
          committed=next;
          failure=null;
        }
        if (hasDraft) {
          await drafts.remove(draftId);
          hasDraft=false; durableDraft=false; await onDraft();
        }
      });
      tail=write.catch(error=>{ failure=error; }).finally(()=>{
        pending--;
        if (failure) onStatus(tr("改动尚未保存"),failure.message);
        else if (!pending) onStatus(tr("✓ 已保存在本机"));
      });
      return write;
    },
  };
}
