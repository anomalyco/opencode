import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('./background.js', import.meta.url), 'utf8');

// Exercise the real worker against an in-memory browser API boundary.
function browser(initial = [], saved = {}) {
  const tabs = new Map(initial.map(tab => [tab.id, {...tab}]));
  const windows = new Set(initial.map(tab => tab.windowId));
  const listeners = {};
  const updates = [];
  const events = [];
  let next = 100;
  let createdWindows = 0;
  const event = name => ({addListener: listener => { listeners[name] = listener; }});
  const chrome = {
    action: {onClicked: event('click')},
    alarms: {create() {}, onAlarm: event('alarm')},
    runtime: {id: 'extension', onMessage: event('message'), onStartup: event('startup'),
      onInstalled: event('install'), openOptionsPage() {}},
    storage: {
      session: {
        async get() { return {...saved}; },
        async set(value) { Object.assign(saved, value); },
        async remove(key) { delete saved[key]; },
      },
      local: {async get() { return {bridgeConfig: {port: 17384, key: 'test'}}; }},
    },
    tabs: {
      onRemoved: event('removed'), onUpdated: event('updated'),
      async get(id) {
        if (!tabs.has(id)) throw new Error('Missing tab');
        return {...tabs.get(id)};
      },
      async query() { return [...tabs.values()].filter(tab => tab.url.startsWith('https://chatgpt.com/')); },
      async create(options) {
        assert.ok(windows.has(options.windowId));
        const tab = {id: next++, ...options};
        tabs.set(tab.id, tab);
        return {...tab};
      },
      async update(id, options) {
        assert.ok(tabs.has(id));
        updates.push({id, ...options});
        Object.assign(tabs.get(id), options);
        return {...tabs.get(id)};
      },
      async remove(id) { tabs.delete(id); listeners.removed(id); },
      async sendMessage(id) {
        return {ok: true, page_epoch: 'epoch-' + id, state: 'READY', url: tabs.get(id).url};
      },
    },
    windows: {
      async get(id) {
        if (!windows.has(id)) throw new Error('Missing window');
        return {id};
      },
      async create(options) {
        createdWindows++;
        const id = next++;
        windows.add(id);
        return {id, tabs: [await chrome.tabs.create({windowId: id, url: options.url})]};
      },
      async update(id) { assert.ok(windows.has(id)); },
    },
  };
  const worker = runInNewContext(source + '; ({managedTab, dispatch})', {
    chrome, URL, AbortSignal,
    fetch: (url, options) => {
      if (!url.endsWith('/event')) return new Promise(() => {});
      events.push(JSON.parse(options.body));
      return Promise.resolve({ok: true, json: async () => ({ok: true})});
    },
    setTimeout: callback => { queueMicrotask(callback); return 1; },
    clearTimeout() {},
  });
  return {worker, tabs, windows, saved, updates, events, chrome, createdWindows: () => createdWindows};
}

test('concurrent activation and repeated model selection reuse one window and tab', async () => {
  const state = browser();
  const results = await Promise.all(Array.from({length: 8}, () => state.worker.managedTab({focus: true})));
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  assert.equal(state.tabs.size, 1);
  assert.equal(state.createdWindows(), 1);
  assert.equal(state.saved.managedWindowId, [...state.windows][0]);
});

test('fresh conversations navigate the bound tab without replacing it', async () => {
  const state = browser([{id: 1, windowId: 2, url: 'https://chatgpt.com/c/old'}],
    {managedTabId: 1, managedWindowId: 2});
  const result = await state.worker.managedTab({fresh: true});
  assert.equal(result.id, 1);
  assert.equal(state.tabs.get(1).url, 'https://chatgpt.com/');
  assert.equal(state.tabs.size, 1);
  assert.equal(state.createdWindows(), 0);
});

test('activation preserves an existing conversation and adopts the persisted binding', async () => {
  const state = browser([{id: 1, windowId: 2, url: 'https://chatgpt.com/c/old'}],
    {managedTabId: 1, managedWindowId: 2});
  await state.worker.dispatch({operation: 'activate'});
  assert.equal(state.tabs.get(1).url, 'https://chatgpt.com/c/old');
  assert.ok(state.updates.every(update => !('url' in update)));
});

test('personal ChatGPT tabs are not adopted or closed', async () => {
  const state = browser([{id: 1, windowId: 2, url: 'https://chatgpt.com/c/personal'}]);
  const result = await state.worker.managedTab({focus: true});
  assert.notEqual(result.id, 1);
  assert.equal(state.tabs.get(1).url, 'https://chatgpt.com/c/personal');
  assert.equal(state.createdWindows(), 1);
});

test('desktop bootstrap is adopted and duplicate bootstrap tabs are removed', async () => {
  const state = browser([
    {id: 1, windowId: 2, url: 'https://chatgpt.com/#opencode-bridge'},
    {id: 3, windowId: 4, url: 'https://chatgpt.com/#opencode-bridge'},
  ]);
  const result = await state.worker.managedTab({focus: true});
  assert.equal(result.id, 1);
  assert.equal(state.tabs.size, 1);
  assert.equal(state.createdWindows(), 0);
});

test('closed tab is replaced in its original surviving window', async () => {
  const state = browser([{id: 1, windowId: 2, url: 'https://chatgpt.com/'}],
    {managedTabId: 1, managedWindowId: 2});
  await state.worker.managedTab({focus: true});
  await state.chrome.tabs.remove(1);
  const result = await state.worker.managedTab({focus: true});
  assert.equal(state.tabs.get(result.id).windowId, 2);
  assert.equal(state.createdWindows(), 0);
});

test('closed window is replaced once and stop never creates a replacement', async () => {
  const state = browser([], {managedTabId: 1, managedWindowId: 2});
  await assert.rejects(state.worker.managedTab({requireExisting: true}), /SESSION_LOST/);
  assert.equal(state.createdWindows(), 0);
  await state.worker.managedTab({focus: true});
  await state.worker.managedTab({focus: true});
  assert.equal(state.createdWindows(), 1);
});

test('restoring another conversation navigates the same bound tab', async () => {
  const state = browser([{id: 1, windowId: 2, url: 'https://chatgpt.com/c/old'}],
    {managedTabId: 1, managedWindowId: 2});
  await state.worker.dispatch({id: 'open-job', operation: 'open', url: 'https://chatgpt.com/c/restored'});
  assert.equal(state.tabs.get(1).url, 'https://chatgpt.com/c/restored');
  assert.equal(state.tabs.size, 1);
  assert.equal(state.createdWindows(), 0);
  assert.equal(state.events[0].event.type, 'control.completed');
});

test('late desktop bootstrap is cleaned up without replacing the bound conversation', async () => {
  const state = browser([{id: 1, windowId: 2, url: 'https://chatgpt.com/c/old'}],
    {managedTabId: 1, managedWindowId: 2});
  await state.worker.managedTab({focus: true});
  state.tabs.set(3, {id: 3, windowId: 4, url: 'https://chatgpt.com/#opencode-bridge'});
  await state.worker.managedTab({focus: true});
  assert.equal(state.tabs.size, 1);
  assert.equal(state.tabs.get(1).url, 'https://chatgpt.com/c/old');
});
