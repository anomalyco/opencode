const status = document.querySelector('#status');

document.querySelector('#reconnect').onclick = async () => {
  await chrome.runtime.sendMessage({type: 'start'});
  await refresh();
};

async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({type: 'status'});
    status.textContent = result.connected ? '已连接本机桥接。' : '等待本机桥接启动，扩展会自动重试。';
  } catch {
    status.textContent = '等待扩展后台启动。';
  }
}

void refresh();
setInterval(refresh, 5000);
