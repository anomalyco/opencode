export const PREVIEW_URL = "https://vibe.laterdev.com/preview"

export const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #191515;
    color: rgba(255, 255, 255, 0.78);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    max-width: 320px;
    text-align: center;
    padding: 32px;
  }

  .icon-wrapper {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-wrapper svg {
    width: 24px;
    height: 24px;
    color: rgba(255, 255, 255, 0.44);
  }

  .text-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h1 {
    font-size: 15px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: -0.01em;
  }

  p {
    font-size: 13px;
    font-weight: 400;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.44);
  }

  .action {
    width: 100%;
    margin-top: 4px;
  }

  .start-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    font-family: inherit;
    color: inherit;
  }

  .start-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.16);
  }

  .start-btn:active {
    background: rgba(255, 255, 255, 0.13);
  }

  .btn-icon svg {
    width: 16px;
    height: 16px;
    color: rgba(255, 255, 255, 0.58);
  }

  .btn-label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.78);
  }

  .state-idle {}
  .state-loading, .state-timeout { display: none; }
  body.loading .state-idle { display: none; }
  body.loading .state-loading { display: flex; }
  body.timeout .state-idle { display: none; }
  body.timeout .state-timeout { display: flex; }

  .status {
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 16px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.58);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .status-text {
    font-size: 12px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.34);
  }

  .timeout-msg {
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
  }

  .timeout-text {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.34);
  }

  .retry-btn {
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.58);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  @media (prefers-color-scheme: light) {
    body { background: #fcfcfc; color: rgba(0, 0, 0, 0.7); }
    .icon-wrapper { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.08); }
    .icon-wrapper svg { color: rgba(0, 0, 0, 0.34); }
    h1 { color: rgba(0, 0, 0, 0.87); }
    p { color: rgba(0, 0, 0, 0.44); }
    .start-btn { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.1); }
    .start-btn:hover { background: rgba(0, 0, 0, 0.07); border-color: rgba(0, 0, 0, 0.14); }
    .start-btn:active { background: rgba(0, 0, 0, 0.09); }
    .btn-icon svg { color: rgba(0, 0, 0, 0.44); }
    .btn-label { color: rgba(0, 0, 0, 0.7); }
    .spinner { border-color: rgba(0, 0, 0, 0.1); border-top-color: rgba(0, 0, 0, 0.5); }
    .status-text { color: rgba(0, 0, 0, 0.34); }
    .timeout-text { color: rgba(0, 0, 0, 0.34); }
    .retry-btn { color: rgba(0, 0, 0, 0.55); background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.1); }
    .retry-btn:hover { background: rgba(0, 0, 0, 0.07); }
  }
</style>
</head>
<body>
  <div class="container">
    <div class="icon-wrapper">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    </div>
    <div class="text-group">
      <h1>Nothing to show yet</h1>
      <p>Click below to start your app. The preview will appear automatically once it's ready.</p>
    </div>
    <div class="action">
      <div class="state-idle">
        <button class="start-btn" onclick="window.parent.postMessage({type:'preview-start'},'*')">
          <span class="btn-icon">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 4L16 10L6 16V4Z"/></svg>
          </span>
          <span class="btn-label">Start your app</span>
        </button>
      </div>
      <div class="status state-loading">
        <div class="spinner"></div>
        <span class="status-text">Getting things ready...</span>
      </div>
      <div class="timeout-msg state-timeout">
        <span class="timeout-text">Taking longer than expected.</span>
        <button class="retry-btn" onclick="window.parent.postMessage({type:'preview-retry'},'*')">Try again</button>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('message', function(e) {
      document.body.className = '';
      if (e.data && e.data.state) {
        document.body.className = e.data.state;
      }
    });
  </script>
</body>
</html>`
