document.querySelector('#connect').onclick = async () => {
  try {
    const config = JSON.parse(document.querySelector('#config').value);
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
        typeof config.key !== 'string' || config.key.length < 32) throw new Error('配置格式不正确');
    await chrome.storage.local.set({bridgeConfig: {port: config.port, key: config.key}});
    await chrome.runtime.sendMessage({type: 'start'});
    document.querySelector('#config').value = '';
    document.querySelector('#status').textContent = '已连接。请打开或刷新已登录的 ChatGPT 页面，再运行 Python 客户端。';
  } catch (error) { document.querySelector('#status').textContent = error.message; }
};
document.querySelector('#disconnect').onclick = async () => {
  await chrome.storage.local.remove('bridgeConfig');
  document.querySelector('#status').textContent = '已断开';
};
