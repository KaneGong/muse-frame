import {english} from './language-en.mjs';
import {sceneEnglish} from './language-scenes-en.mjs';
import {presetEnglish} from './language-presets-en.mjs';

const storageKey = 'muse-frame-language';
const interfaceEnglish = Object.assign(Object.create(null), sceneEnglish, presetEnglish, english);
let language = 'zh-CN';

export function getLanguage() {
  return language;
}

export function setLanguage(value) {
  if (value === 'zh-CN' || value === 'en') language = value;
  return language;
}

export function browserLanguage(storage, languages = []) {
  let choice;
  try { choice = storage?.getItem(storageKey); } catch {}
  if (choice === 'zh-CN' || choice === 'en') return choice;
  return /^zh(?:-|$)/i.test(languages[0] || '') ? 'zh-CN' : 'en';
}

export function rememberLanguage(storage) {
  try { storage?.setItem(storageKey, language); } catch {}
}

// Only call this for interface strings and known catalog metadata. Prompts,
// user-entered values, asset names and filenames are rendered separately.
export function tr(source, ...values) {
  const message = language === 'en' && Object.hasOwn(interfaceEnglish, source) ? interfaceEnglish[source] : source;
  if (!values.length) return message;
  return message.replace(/\{(\d+)\}/g, (token, index) => Number(index) < values.length ? String(values[index] ?? '') : token);
}

export function shootTitle(shoot) {
  const {title, titleEdited} = shoot;
  if (titleEdited) return title;
  if ((title === '自由拍摄' && shoot.free && shoot.referenceMode !== 'text') ||
      ['新的拍摄', '商品展示', '街角穿搭 · 试用'].includes(title)) return tr(title);
  const plan = shoot.creativePlan?.name;
  return plan && title === plan + ' · 新拍摄' ? tr("{0} · 新拍摄", tr(plan)) : title;
}

export function shotTitle(shot) {
  const {title, titleEdited} = shot;
  if (titleEdited || typeof title !== 'string') return title;
  const auto = /^(镜头|新增镜头) (\d+)((?: · 副本)*)$/.exec(title);
  if (auto) {
    return tr(auto[1] === '镜头' ? "镜头 {0}" : "新增镜头 {0}", auto[2]) +
      tr(" · 副本").repeat(auto[3].length / ' · 副本'.length);
  }
  return shot.titleSource === 'preset' || (shot.poseRecommended && !shot.manual) ? tr(title) : title;
}

export function sceneReferenceName(id, name) {
  if (!id?.startsWith('space-reference-') || typeof name !== 'string') return name;
  return name.split(' · ').map(part => tr(part)).join(' · ');
}
