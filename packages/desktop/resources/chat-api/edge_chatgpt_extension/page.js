// Calls the existing site's authenticated HTTP client, not DOM chat controls.
// Adapter verified against this loaded frontend bundle. Fail explicitly on upgrade.
async function executeChatGPTJob(job) {
  const bundle = '/cdn/assets/4813494d-gycm0sx6lon4voy5.js';
  const loaded = performance.getEntriesByType('resource').some(e => e.name.endsWith(bundle));
  if (!loaded) throw new Error('ChatGPT 前端版本已变化或尚未加载，请更新网页适配器');
  const m = await import(bundle);
  if (typeof m.Go !== 'function' || typeof m.X2?.request !== 'function' || typeof m.Qo !== 'function') {
    throw new Error('ChatGPT 前端适配器不匹配');
  }
  m.Qo();
  if (job.operation === 'models') {
    return m.X2.safeGet('/models', {parameters: {query: {iim: false, is_gizmo: false}}});
  }
  if (job.operation !== 'chat') throw new Error('Unsupported operation');
  const body = {...job.body, client_prepare_state: 'success',
    timezone_offset_min: new Date().getTimezoneOffset(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    supports_buffering: true, enable_message_followups: true};
  if (!Array.isArray(body.messages) || body.messages.length !== 1 ||
      body.messages[0]?.author?.role !== 'user') throw new Error('无效的用户消息');
  const requirements = await m.Go(false);
  const [proof, turnstile] = await Promise.all([
    m.cs.getEnforcementToken(requirements, {forceSync: true}),
    m.is.getEnforcementToken(requirements),
  ]);
  const preparation = {...body, client_prepare_state: 'none',
    client_prepare_dispatch: 'immediate', client_prepare_source: 'composer_editor_state',
    partial_query: body.messages[0]};
  delete preparation.messages;
  const conduit = await m.X2.safePost('/f/conversation/prepare', {
    requestBody: preparation, additionalHeaders: {'x-oai-turn-trace-id': crypto.randomUUID(),
      'oai-genui-client-actions': 'open_entity_detail'}, disableAutomaticRetry: true,
  });
  if (!conduit?.conduit_token) throw new Error('网页未返回 conduit_token');
  const response = await m.X2.request('post', '/f/conversation', {
    requestBody: body, additionalHeaders: {...m.Yo(requirements, turnstile, proof),
      'x-conduit-token': conduit.conduit_token, 'x-oai-turn-trace-id': crypto.randomUUID(),
      Accept: 'text/event-stream', 'x-openai-web-sse-compression': 'identity'},
    disableAutomaticRetry: true,
  });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('text/event-stream')) {
    throw new Error('网页对话响应无效 HTTP ' + response.status);
  }
  return {sse: await response.text()};
}

window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== 'https://chatgpt.com' || event.data?.type !== 'CHAT_API_JOB') return;
  const {id, channel, job} = event.data;
  if (typeof id !== 'string' || typeof channel !== 'string' || !['models', 'chat'].includes(job?.operation)) return;
  let result;
  try { result = {ok: true, result: await executeChatGPTJob(job)}; }
  catch (error) {
    // Never serialize native RequestError objects: they can include server data.
    result = {ok: false, error: error.status ? 'ChatGPT HTTP ' + error.status : String(error.message || '网页请求失败')};
  }
  window.postMessage({type:'CHAT_API_RESULT', id, channel, result}, 'https://chatgpt.com');
});
