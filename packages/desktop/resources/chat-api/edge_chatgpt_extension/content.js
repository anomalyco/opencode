const adapter = new ChatGPTDomAdapter();
let eventChain = Promise.resolve();

function emit(jobId, event) {
  eventChain = eventChain.catch(() => {}).then(async () => {
    const reply = await chrome.runtime.sendMessage({type: 'event', jobId, event});
    if (!reply?.ok) throw new Error(reply?.error || '事件未送达本机桥接');
  });
  return eventChain;
}

function errorEvent(error) {
  const message = String(error?.message || error);
  return {type: 'chat.error', code: /^[A-Z_]+:/.test(message) ? message.split(':', 1)[0] : 'PAGE_ERROR',
          message};
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'ping') {
    reply({ok: true, ...adapter.health()});
    return;
  }
  if (message.type === 'reset') {
    void adapter.resetEditor().then(result => reply({ok: true, result}))
      .catch(error => reply({ok: false, error: String(error.message || error)}));
    return true;
  }
  if (message.type !== 'job' || !message.job?.id) return;
  const job = message.job;
  if (job.page_epoch && job.page_epoch !== adapter.pageEpoch) {
    reply({ok: false, error: 'SESSION_LOST: 页面代次已改变'});
    return;
  }
  reply({ok: true});
  if (job.operation === 'chat') {
    void adapter.runChat(job, event => emit(job.id, event)).catch(async error => {
      await emit(job.id, errorEvent(error)).catch(() => {});
    });
  } else if (job.operation === 'stop') {
    void adapter.stop(job).then(result => emit(job.id, {type: 'control.completed', result}))
      .catch(error => emit(job.id, errorEvent(error)).catch(() => {}));
  } else if (job.operation === 'health') {
    void emit(job.id, {type: 'control.completed', result: adapter.health()}).catch(() => {});
  } else {
    void emit(job.id, {type: 'chat.error', code: 'BAD_OPERATION', message: '不支持的操作'}).catch(() => {});
  }
});

chrome.runtime.sendMessage({type: 'ready', page_epoch: adapter.pageEpoch}).catch(() => {});
