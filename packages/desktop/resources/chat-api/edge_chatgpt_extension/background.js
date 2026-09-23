/* Routes jobs only to the dedicated tab. Other ChatGPT tabs cannot take over. */
let polling = false;
let managedTabId = null;
let managedEpoch = null;
let activeChatJob = null;

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'ready') {
    if (sender.tab?.id === managedTabId) {
      if (managedEpoch && managedEpoch !== message.page_epoch && activeChatJob) {
        void postEvent(activeChatJob, {type: 'chat.error', code: 'SESSION_LOST',
          message: '专用页面已刷新，消息状态未知'}).catch(() => {});
        activeChatJob = null;
      }
      managedEpoch = message.page_epoch;
    }
    reply({ok: true});
    return;
  }
  if (message.type === 'start') {
    void run();
    reply({ok: true});
    return;
  }
  if (message.type === 'event') {
    if (sender.tab?.id !== managedTabId || sender.frameId !== 0 ||
        (message.event.page_epoch && message.event.page_epoch !== managedEpoch)) {
      reply({ok: false, error: 'SESSION_LOST: 事件不是专用页面发出的'});
      return;
    }
    void postEvent(message.jobId, message.event).then(() => {
      if (['chat.completed', 'chat.cancelled', 'chat.error'].includes(message.event.type) &&
          message.jobId === activeChatJob) activeChatJob = null;
      reply({ok: true});
    }).catch(error => reply({ok: false, error: String(error.message || error)}));
    return true;
  }
});

chrome.alarms.create('dom-bridge', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(() => void run());
chrome.runtime.onStartup.addListener(() => void run());
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === managedTabId) {
    managedTabId = managedEpoch = null;
    void chrome.storage.session.remove('managedTabId');
    if (activeChatJob) {
      void postEvent(activeChatJob, {type: 'chat.error', code: 'SESSION_LOST',
        message: '专用标签页已关闭，消息状态未知'}).catch(() => {});
      activeChatJob = null;
    }
  }
});

async function config() {
  return (await chrome.storage.local.get('bridgeConfig')).bridgeConfig;
}

async function api(path, options = {}) {
  const current = await config();
  if (!current) throw new Error('扩展尚未连接本机桥接');
  const response = await fetch('http://127.0.0.1:' + current.port + path, {
    ...options,
    headers: {'X-Chat-Bridge-Key': current.key, 'Content-Type': 'application/json'},
    signal: AbortSignal.timeout(options.timeout || 12000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || '桥接请求失败');
  return data;
}

async function postEvent(jobId, event) {
  await api('/event', {method: 'POST', body: JSON.stringify({id: jobId, event})});
}

async function ping(tabId) {
  const result = await chrome.tabs.sendMessage(tabId, {type: 'ping'});
  if (!result?.ok || !result.page_epoch) throw new Error('专用页面尚未加载');
  managedEpoch = result.page_epoch;
  return result;
}

async function waitForTab(tabId) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try {
      const health = await ping(tabId);
      if (health.state === 'READY') {
        await new Promise(resolve => setTimeout(resolve, 700));
        const settled = await ping(tabId);
        if (settled.state === 'READY' && settled.page_epoch === health.page_epoch) return settled;
      }
      if (['GENERATING', 'LOGIN_REQUIRED', 'CHALLENGE_REQUIRED'].includes(health.state)) return health;
    }
    catch { await new Promise(resolve => setTimeout(resolve, 300)); }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('PAGE_LOADING: 专用 ChatGPT 页面未就绪');
}

async function managedTab({fresh = false, requireExisting = false} = {}) {
  if (managedTabId === null) {
    const saved = await chrome.storage.session.get('managedTabId');
    managedTabId = Number.isInteger(saved.managedTabId) ? saved.managedTabId : null;
  }
  if (!fresh && managedTabId !== null) {
    let tab;
    try {
      tab = await chrome.tabs.get(managedTabId);
    } catch {
      if (requireExisting) throw new Error('SESSION_LOST: 正在生成的专用标签页已关闭');
    }
    if (tab?.url?.startsWith('https://chatgpt.com/'))
      return {id: managedTabId, health: await waitForTab(managedTabId)};
  }
  if (requireExisting) throw new Error('SESSION_LOST: 找不到正在生成的专用标签页');
  const old = managedTabId;
  const tab = await chrome.tabs.create({url: 'https://chatgpt.com/', active: false});
  managedTabId = tab.id;
  managedEpoch = null;
  await chrome.storage.session.set({managedTabId: tab.id});
  const health = await waitForTab(tab.id);
  if (fresh && old !== null && old !== tab.id) await chrome.tabs.remove(old).catch(() => {});
  return {id: tab.id, health};
}

async function dispatch(job) {
  try {
    if (job.operation === 'new') {
      if (activeChatJob) throw new Error('BUSY: 正在生成回答');
      const tab = await managedTab({fresh: true});
      if (tab.health.state !== 'READY') throw new Error(tab.health.state + ': 新聊天页面未就绪');
      const reset = await chrome.tabs.sendMessage(tab.id, {type: 'reset'});
      if (!reset?.ok) throw new Error(reset?.error || '新聊天草稿未清空');
      await postEvent(job.id, {type: 'control.completed', result: reset.result});
      return;
    }
    if (job.operation === 'open') {
      const target = new URL(job.url);
      if (target.origin !== 'https://chatgpt.com' || !target.pathname.startsWith('/c/'))
        throw new Error('BAD_URL: 会话地址无效');
      let tab = await managedTab();
      if (tab.health.url !== target.href) {
        await chrome.tabs.update(tab.id, {url: target.href});
        tab = {id: tab.id, health: await waitForTab(tab.id)};
      }
      if (tab.health.state !== 'READY' || tab.health.url !== target.href)
        throw new Error('SESSION_LOST: 网页会话尚未恢复');
      await postEvent(job.id, {type: 'control.completed', result: tab.health});
      return;
    }
    const tab = await managedTab({requireExisting: job.operation === 'stop'});
    if (job.operation === 'chat') activeChatJob = job.id;
    const result = await chrome.tabs.sendMessage(tab.id, {type: 'job', job: {...job, page_epoch: managedEpoch}});
    if (!result?.ok) throw new Error(result?.error || '页面拒绝了命令');
  } catch (error) {
    if (activeChatJob === job.id) activeChatJob = null;
    const message = String(error.message || error);
    const code = /^[A-Z_]+:/.test(message) ? message.split(':', 1)[0] : 'PAGE_ERROR';
    await postEvent(job.id, {type: 'chat.error', code, message}).catch(() => {});
  }
}

async function run() {
  if (polling) return;
  polling = true;
  try {
    while (await config()) {
      const {job} = await api('/next', {timeout: 12000});
      if (job) void dispatch(job);
    }
  } catch { /* Alarm or options page reconnects after bridge restart. */ }
  finally { polling = false; }
}

void run();
