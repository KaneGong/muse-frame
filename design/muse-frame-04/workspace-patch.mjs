// Content is mutable in the editor. Share unchanged branches with the last queued
// snapshot so later edits cannot alter a queued write or copy historical images.
export function snapshot(value, base) {
  if (value === null || typeof value !== 'object' || value === base) return value;
  const array = Array.isArray(value);
  const old = base && typeof base === 'object' && Array.isArray(base) === array ? base : null;
  const next = array ? [] : {};
  let same = Boolean(old);
  let count = 0;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined && !array) continue;
    count++;
    next[key] = snapshot(value[key] ?? null, old?.[key]);
    if (!old || !Object.hasOwn(old, key) || old[key] !== next[key]) same = false;
  }
  return same && count === Object.keys(old).length ? old : next;
}

const collections = new Set(['shoots','shots','outputs','assets','tasks','recipes','experiments','products','batches']);
function keyed(items) {
  const map = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || map.has(item.id)) return null;
    map.set(item.id, item);
  }
  return map;
}

export function changes(before, after, path = [], ops = []) {
  if (before === after) return ops;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    if (!Array.isArray(before) && !Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        changes(before[key], after[key], [...path,key], ops);
      }
      return ops;
    }
    if (Array.isArray(before) && Array.isArray(after) && collections.has(path.at(-1))) {
      const previous = keyed(before), current = keyed(after);
      if (previous && current) {
        for (const id of new Set([...previous.keys(), ...current.keys()])) {
          changes(previous.get(id), current.get(id), [...path,{id}], ops);
        }
        // Inserts append by default. Only send IDs when the editor actually moved a row.
        const natural = [...previous.keys()].filter(id=>current.has(id))
          .concat([...current.keys()].filter(id=>!previous.has(id)));
        const order = [...current.keys()];
        if (natural.some((id,i)=>id !== order[i])) ops.push({path,order:true,before:natural,after:order});
        return ops;
      }
    }
  }
  ops.push({path,...(before === undefined ? {} : {before}),...(after === undefined ? {} : {after})});
  return ops;
}

export function sharedDocument(state, ui = {}) {
  const {currentShoot, ...content} = state;
  const shared = {};
  for (const key of ['language','customDrafts','lookSources']) {
    if (ui?.[key] !== undefined) shared[key] = ui[key];
  }
  return {state:content,ui:shared};
}

export function packImages(document, stored) {
  const media = [], indices = new Map();
  const packed = JSON.parse(JSON.stringify(document, (_,value) => {
    if (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(value)) return value;
    if (stored.has(value)) return stored.get(value);
    if (!indices.has(value)) { indices.set(value,media.length); media.push(value); }
    return {__mfImage:indices.get(value)};
  }));
  return {...packed,media};
}

export function readPath(document, path) {
  let value = document;
  for (const key of path) {
    value = typeof key === 'string' ? value?.[key] : Array.isArray(value) ? value.find(row=>row?.id===key.id) : undefined;
  }
  return value;
}

export function windowView(workspace, storage, recent) {
  const key = 'muse-frame-window-' + workspace.workspaceId;
  function read() {
    try {
      const view = JSON.parse(storage.getItem(key)) || {};
      const shoot = view.currentShoot || recent.getItem(key);
      if (workspace.state?.shoots.some(item=>item.id===shoot && !item.archived)) workspace.state.currentShoot = shoot;
      return view.ui || {};
    } catch { return {}; }
  }
  function save(state, ui) {
    const {dialog,gallery,customDrafts,lookSources,language,...view} = ui;
    // A blocked browser preference store must not prevent SQLite content saves.
    try { storage.setItem(key,JSON.stringify({currentShoot:state.currentShoot,ui:view})); } catch {}
    try { recent.setItem(key,state.currentShoot); } catch {}
  }
  return {read,save};
}
