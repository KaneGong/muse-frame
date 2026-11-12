import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {browserLanguage} from '../language.mjs';
import {createInitialState} from '../creative-model.mjs';
import {createShoot} from '../model.mjs';

const root = new URL('../', import.meta.url);
const rawPrompt = '保留原文：<米白色> & exact.';
const title = '我的拍摄 & 测试';
const poseName = '外部图库中的原名';

test('browser language picks Simplified Chinese for Chinese locales and English otherwise', () => {
  assert.equal(browserLanguage(null, ['zh-Hant', 'en']), 'zh-CN');
  assert.equal(browserLanguage(null, ['en-US', 'zh-CN']), 'en');
  assert.equal(browserLanguage({getItem: () => 'en'}, ['zh-CN']), 'en');
});

test('native workspace keeps explicit language and localizes the workflow without changing source content', async () => {
  const workspace = createInitialState();
  const shoot = workspace.shoots.find(item => item.id === workspace.currentShoot);
  Object.assign(shoot, {title, customPrompt: rawPrompt, promptMode: 'custom',
    nativeSettings: {platform: 'lovart', model: 'fixture', ratio: '3:4', resolution: 'default'}});
  const freeShoot = createShoot(workspace, {free: true});
  freeShoot.referenceMode = 'photo';
  workspace.currentShoot = shoot.id;
  const dom = new JSDOM(await fs.readFile(new URL('index.html', root), 'utf8'), {
    url: 'http://127.0.0.1:19014/',
  });
  const {window} = dom;
  Object.assign(globalThis, {window, document: window.document, localStorage: window.localStorage});
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  Object.assign(document.body.dataset, {runtime: 'local', packaged: 'true', workspaceEpoch: 'fixture-epoch'});
  Object.defineProperty(window.navigator, 'languages', {value: ['zh-CN']});
  let revision = 0;
  let authorizationRequired = false;
  let referenceFailure = false;
  const writes = [];
  const actualInterval = globalThis.setInterval;
  const actualFetch = globalThis.fetch;
  const actualTimeout = globalThis.setTimeout;
  const toastTimers = [];
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = actualTimeout(callback, delay, ...args);
    if (delay === 3800) toastTimers.push(timer);
    return timer;
  };
  globalThis.fetch = async (url, options) => {
    if (!url.startsWith('/api/')) return new Response(await fs.readFile(new URL(url, root)));
    const path = url.slice(5);
    if (!path.startsWith('gallery')) assert.equal(options.headers['X-Muse-Workspace'], 'fixture-epoch');
    const payload = options?.body ? JSON.parse(options.body) : null;
    let response;
    if (path === 'design-workspace') {
      if (payload) writes.push(payload);
      response = payload ? {revision: ++revision, media: []} : {state: workspace, ui: {language: 'en'}, revision};
    } else if (path === 'state') {
      response = {connection: authorizationRequired ?
        {state: 'disconnected', message: 'E_LOGIN_REQUIRED: 尚未完成 Lovart 授权；请运行 python lovart_direct.py --login'} :
        {state: 'connected'}, platform: {current: 'lovart', options: [{id: 'lovart', name: 'Lovart'}, {id: 'libtv', name: 'LibTV'}]},
        models: [{name: 'fixture', display_name: 'Fixture model'}]};
    } else if (path === 'lovart-login') {
      assert.equal(payload, null);
      response = {state: 'idle'};
    } else if (path.startsWith('schema?')) {
      response = {properties: {aspect_ratio: {enum: ['3:4']}}};
    } else if (path === 'design-jobs') {
      assert.equal(payload, null, 'This check must never submit a generation task');
      response = {jobs: []};
    } else if (path === 'design-review') {
      assert.equal(payload.shots[0].prompt, rawPrompt);
      if (referenceFailure) return Response.json({
        error: '无法读取场景参考原图。请返回拍摄重新选择或上传。',
      }, {status: 400});
      response = {reviewToken: 'fixture', shots: [{
        title: '镜头原名', prompt: rawPrompt, manual: true,
        references: [{role: 'face', number: 1, assetId: 'face-1', name: poseName, image: 'assets/street.webp'}],
      }]};
    } else if (path.startsWith('gallery?')) {
      response = {items: [{id: 'face-1', category: '面部', name: poseName, image: 'assets/street.webp'}]};
    } else throw Error('Unexpected fixture request '+path);
    return Response.json(response);
  };

  const find = selector => {
    const element = document.querySelector(selector);
    assert.ok(element, selector);
    return element;
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  const click = async action => {
    (document.querySelector(`dialog[open] [data-action="${action}"]`) || find(`[data-action="${action}"]`)).click();
    await settle();
  };
  const setValue = async (selector, value) => {
    const element = find(selector);
    element.value = value;
    element.dispatchEvent(new window.Event('change', {bubbles: true}));
    await settle();
  };
  try {
    await import('../app.mjs');
    await settle();
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(find('.project-name').textContent, title);
    assert.match(find('.capture-mode').textContent, /Quick Shoot.*Advanced/);

    await click('projects');
    assert.equal(find('#sheet-title').textContent, 'Your shoots');
    assert.match(find('a[href="/workspace-migration"]').textContent, /Workspace migration and backup/);
    assert.equal(document.querySelector('a[href="/legacy/"]'), null);
    await setValue('#sheet [data-language]', 'zh-CN');
    assert.equal(find('#sheet-title').textContent, '你的拍摄');
    assert.equal(writes.at(-1).ui.language, 'zh-CN');
    await setValue('#sheet [data-language]', 'en');
    assert.equal(writes.at(-1).ui.language, 'en');
    assert.equal(localStorage.getItem('muse-frame-language'), 'en');
    assert.equal(writes.at(-1).state.shoots.find(item => item.id === shoot.id).customPrompt, rawPrompt);
    await click('close');

    find('[data-action="gallery"][data-kind="person"]').click();
    await settle();
    assert.equal(find('#sheet-title').textContent, 'Person gallery');
    assert.match(find('.gallery-scope').textContent, /Face/);
    assert.equal(find('.gallery-card .gallery-name').textContent, poseName);
    await click('close');

    referenceFailure = true;
    await click('generate-current');
    assert.equal(find('#sheet-title').textContent, 'Could not check references');
    assert.match(find('#sheet [role="alert"]').textContent, /original scene reference/);
    assert.match(find('.dialog-body').textContent, /has not been sent/);
    assert.equal(document.querySelector('[data-action="native-submit"]'), null);
    await click('close');
    referenceFailure = false;
    await click('generate-current');
    assert.equal(find('#sheet-title').textContent, 'Confirm generation');
    assert.match(find('#native-submit-total').textContent, /may deduct credits/);
    assert.equal(find('.reference-review-text .prompt-display').textContent, rawPrompt);
    assert.equal(find('.reference-review figcaption strong').textContent, 'Image 1 · Identity');
    assert.equal(find('.reference-review figcaption small').textContent, poseName);
    await setValue('#native-image-count', '2');
    assert.equal(find('[data-action="native-submit"]').textContent, 'Submit 2 images');
    await click('close');

    await click('tasks');
    assert.equal(find('#sheet-title').textContent, 'Task center');
    await click('close');
    await click('export');
    assert.equal(find('#sheet-title').textContent, 'Export picked images');
    await click('close');

    await click('projects');
    assert.ok(document.querySelector('.sheet-list h3').textContent.includes('Free shoot'));
    find(`[data-action="open-shoot"][data-id="${freeShoot.id}"]`).click();
    await settle();
    assert.equal(find('.project-name').textContent, 'Free shoot');
    assert.equal(find('.project-subtitle').textContent, 'Free shoot · 1 shot');
    assert.equal(find('.shot-open strong').textContent, 'Shot 01');
    assert.match(find('.performance-options').textContent, /Soft smile at camera/);
    assert.doesNotMatch(find('.performance-options').textContent, /\p{Script=Han}/u);

    await click('creative-quick-color');
    assert.equal(find('#sheet-title').textContent, 'Edit Tone');
    const toneCards = [...document.querySelectorAll('.preset-catalog-card')];
    assert.equal(toneCards.length, 4);
    for (const card of toneCards) assert.doesNotMatch(card.textContent, /\p{Script=Han}/u);
    toneCards[0].click();
    await settle();
    assert.equal(find('#creative-picker-choice-label').textContent, 'Natural neutral');
    await click('close');

    await click('creative-spaces');
    assert.equal(find('#sheet-title').textContent, 'Choose scene');
    assert.match(find('.creative-purpose-tabs').textContent, /Portraits/);
    assert.doesNotMatch(find('.creative-purpose-tabs').textContent, /\p{Script=Han}/u);
    assert.doesNotMatch(find('.creative-space-card[data-id="studio"]').textContent, /\p{Script=Han}/u);
    await click('close');

    authorizationRequired = true;
    await click('connections');
    assert.match(find('dialog .notice').textContent, /Lovart needs authorization.*Authorize platform/);
    assert.doesNotMatch(find('dialog .notice').textContent, /python|\p{Script=Han}/u);
    await click('close');

    await click('shoot-name');
    const name = find('#shoot-name-input');
    assert.equal(name.value, 'Free shoot');
    await click('save-shoot-name');
    assert.equal(window.MuseFrame06.state().shoots.find(item => item.id === freeShoot.id).title, '自由拍摄');
    await click('shot-menu');
    const input = find('[data-shot-field="title"]');
    input.value = '镜头 27';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await click('close');
    assert.equal(find('.shot-open strong').textContent, '镜头 27', 'an explicit rename stays in its original language');
  } finally {
    toastTimers.forEach(clearTimeout);
    globalThis.setTimeout = actualTimeout;
    globalThis.fetch = actualFetch;
    globalThis.setInterval = actualInterval;
    window.close();
  }
});
