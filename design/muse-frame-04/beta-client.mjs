import {tr} from './language.mjs';
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
  if (!response.ok || result.error) throw Error(result.error || tr("本机服务请求失败"));
  return result;
}

export function workspaceWriter(revision, onStatus) {
  const storedMedia = new Map();
  let pending = 0;
  let failure = null;
  let tail = Promise.resolve();
  return {
    get unsaved() { return pending > 0 || Boolean(failure); },
    get revision() { return revision; },
    storedImage(value) { return storedMedia.get(value) || value; },
    save(state, ui) {
      const snapshot = structuredClone({state, ui});
      pending++;
      onStatus(tr("正在保存到本机…"));
      const write = tail.then(async () => {
        const media = [];
        const indices = new Map();
        const packed = JSON.parse(JSON.stringify(snapshot, (_, value) => {
          if (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(value)) return value;
          if (storedMedia.has(value)) return storedMedia.get(value);
          if (!indices.has(value)) {
            indices.set(value, media.length);
            media.push(value);
          }
          return {__mfImage: indices.get(value)};
        }));
        const saved = await betaApi('design-workspace', {...packed, revision, media});
        revision = saved.revision;
        media.forEach((value, index) => storedMedia.set(value, saved.media[index]));
        failure = null;
      });
      tail = write.catch(error => { failure = error; }).finally(() => {
        pending--;
        if (failure) onStatus(tr("改动尚未保存"), failure.message);
        else if (!pending) onStatus(tr("✓ 已保存在本机"));
      });
      return write;
    },
  };
}
