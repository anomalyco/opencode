// === PostMessage Protocol Types ===

export type ToSandbox =
  | { type: "render"; html: string }
  | { type: "clear" }
  | { type: "inspect"; enabled: boolean }
  | { type: "ai-response"; id: string; delta?: string; result?: string; done: boolean }
  | { type: "ai-error"; id: string; message: string }
  | { type: "skill-result"; id: string; result: string }
  | { type: "skill-list-result"; id: string; skills: Array<{ name: string; description: string }> }
  | { type: "model-list-result"; id: string; models: Array<{ id: string; provider: string }> }

export type FromSandbox =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "rendered" }
  | { type: "ai-request"; id: string; prompt: string }
  | {
      type: "ai-chat"
      id: string
      messages: Array<{ role: string; content: string }>
      system?: string
      model?: string
    }
  | { type: "ai-stream"; id: string; prompt: string }
  | { type: "skill-invoke"; id: string; skill: string; input: string }
  | { type: "skill-list"; id: string }
  | { type: "model-list"; id: string }
  | { type: "element-selected"; selector: string; tagName: string; textContent: string }

export function postToSandbox(iframe: HTMLIFrameElement, msg: ToSandbox) {
  iframe.contentWindow?.postMessage(msg, "*")
}

export function createSandboxListener(handler: (msg: FromSandbox, source: MessageEventSource | null) => void) {
  const listener = (event: MessageEvent) => {
    const data = event.data
    if (!data || typeof data !== "object" || !data.type) return
    handler(data as FromSandbox, event.source)
  }
  window.addEventListener("message", listener)
  return () => window.removeEventListener("message", listener)
}

// === System Prompt ===

export const PLAYGROUND_SYSTEM_PROMPT = `You are an app generator for OpenPlayground. Generate complete, self-contained HTML documents.

Rules:
1. Output a single HTML file wrapped in \`\`\`html ... \`\`\`
2. Use inline <style> and <script> tags
3. You may load from these CDNs: cdnjs.cloudflare.com, unpkg.com, esm.sh
4. Include a <title> tag — this becomes the window title
5. For AI-powered features, use the window.opencode API available in every app:
   - await window.opencode.complete("prompt") → returns string
   - await window.opencode.chat({ messages: [...], system: "..." }) → returns string
   - await window.opencode.stream("prompt", callback) → returns string, calls callback(chunk) on each delta
   - await window.opencode.skill("skill-name", "input") → invokes an OpenCode skill, returns string
   - await window.opencode.skills() → returns array of { name, description } for available skills
   - await window.opencode.models() → returns array of { id, provider } for available models
6. When modifying an existing window, output the COMPLETE updated HTML
7. When building AI-powered apps, always handle loading states and errors gracefully
8. Use modern CSS (flexbox, grid, custom properties) for layout
9. Make apps visually polished with good typography, spacing, and colors`

// === Sandbox HTML Template ===

export function createSandboxHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh https://fonts.googleapis.com; img-src data: blob: https:; font-src https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com; connect-src https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh">
<title>OpenPlayground</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: auto; font-family: system-ui, -apple-system, sans-serif; }
  #app { width: 100%; min-height: 100%; }
  .opencode-error {
    position: fixed; top: 0; left: 0; right: 0;
    background: #fef2f2; border-bottom: 2px solid #ef4444;
    color: #991b1b; padding: 12px 16px; font-size: 13px;
    font-family: ui-monospace, monospace; z-index: 99999;
    white-space: pre-wrap; word-break: break-all;
  }
  .opencode-inspect-highlight {
    outline: 2px solid #3b82f6 !important;
    outline-offset: 2px !important;
    cursor: pointer !important;
  }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function() {
  // === window.opencode Bridge API ===
  let requestId = 0;
  const pending = new Map();

  function request(type, payload) {
    const id = 'req_' + (++requestId) + '_' + Math.random().toString(36).slice(2, 8);
    return new Promise(function(resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      parent.postMessage(Object.assign({ id: id }, payload, { type: type }), '*');
      setTimeout(function() {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Request timed out after 120s'));
        }
      }, 120000);
    });
  }

  window.opencode = {
    complete: function(prompt) {
      return request('ai-request', { prompt: prompt });
    },
    chat: function(options) {
      return request('ai-chat', {
        messages: options.messages || [],
        system: options.system,
        model: options.model,
        temperature: options.temperature
      });
    },
    stream: function(prompt, onDelta) {
      var id = 'req_' + (++requestId) + '_' + Math.random().toString(36).slice(2, 8);
      return new Promise(function(resolve, reject) {
        var buffer = '';
        pending.set(id, {
          resolve: function(result) { resolve(result); },
          reject: reject,
          onDelta: function(chunk) {
            buffer += chunk;
            if (typeof onDelta === 'function') onDelta(chunk);
          },
          buffer: function() { return buffer; }
        });
        parent.postMessage({ type: 'ai-stream', id: id, prompt: prompt }, '*');
        setTimeout(function() {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('Stream timed out after 120s'));
          }
        }, 120000);
      });
    },
    skill: function(name, input) {
      return request('skill-invoke', { skill: name, input: input });
    },
    skills: function() {
      return request('skill-list', {});
    },
    models: function() {
      return request('model-list', {});
    }
  };

  // Handle responses from parent
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;

    // AI response handling
    if (d.type === 'ai-response' && d.id) {
      var p = pending.get(d.id);
      if (!p) return;
      if (d.delta && p.onDelta) p.onDelta(d.delta);
      if (d.done) {
        pending.delete(d.id);
        p.resolve(d.result || (p.buffer ? p.buffer() : ''));
      }
    }
    if (d.type === 'ai-error' && d.id) {
      var p2 = pending.get(d.id);
      if (p2) { pending.delete(d.id); p2.reject(new Error(d.message)); }
    }

    // Skill/model responses
    if (d.type === 'skill-result' && d.id) {
      var p3 = pending.get(d.id);
      if (p3) { pending.delete(d.id); p3.resolve(d.result); }
    }
    if (d.type === 'skill-list-result' && d.id) {
      var p4 = pending.get(d.id);
      if (p4) { pending.delete(d.id); p4.resolve(d.skills); }
    }
    if (d.type === 'model-list-result' && d.id) {
      var p5 = pending.get(d.id);
      if (p5) { pending.delete(d.id); p5.resolve(d.models); }
    }

    // Render commands
    if (d.type === 'render' && d.html) {
      renderHTML(d.html);
    }
    if (d.type === 'clear') {
      document.getElementById('app').innerHTML = '';
      document.title = 'OpenPlayground';
    }

    // Inspect mode
    if (d.type === 'inspect') {
      toggleInspect(d.enabled);
    }
  });

  // === Render HTML into the page ===
  function renderHTML(html) {
    try {
      clearError();
      var doc = new DOMParser().parseFromString(html, 'text/html');

      // Extract title
      var title = doc.querySelector('title');
      if (title) document.title = title.textContent || 'App';

      // Replace head styles/links
      var existingStyles = document.querySelectorAll('head style.user-style, head link.user-link');
      existingStyles.forEach(function(el) { el.remove(); });

      doc.querySelectorAll('head style, head link[rel="stylesheet"]').forEach(function(el) {
        var clone = document.importNode(el, true);
        clone.classList.add(el.tagName === 'STYLE' ? 'user-style' : 'user-link');
        document.head.appendChild(clone);
      });

      // Replace body content
      var app = document.getElementById('app');
      app.innerHTML = doc.body.innerHTML;

      // Execute scripts in order
      var scripts = doc.querySelectorAll('body script, head script');
      var scriptTexts = [];
      scripts.forEach(function(s) {
        if (s.src) return; // skip external src scripts in initial parse
        scriptTexts.push(s.textContent);
      });

      // Execute inline scripts
      scriptTexts.forEach(function(text) {
        try {
          var fn = new Function(text);
          fn();
        } catch(err) {
          showError(err.message);
        }
      });

      parent.postMessage({ type: 'rendered' }, '*');
    } catch(err) {
      showError('Render error: ' + err.message);
    }
  }

  // === Error display ===
  function showError(msg) {
    clearError();
    var div = document.createElement('div');
    div.className = 'opencode-error';
    div.id = 'opencode-error';
    div.textContent = msg;
    document.body.prepend(div);
    parent.postMessage({ type: 'error', message: msg }, '*');
  }

  function clearError() {
    var existing = document.getElementById('opencode-error');
    if (existing) existing.remove();
  }

  // === Inspect mode (hover highlight + click to select) ===
  var inspectActive = false;
  var lastHighlighted = null;

  function inspectOver(e) {
    if (!inspectActive) return;
    var el = e.target;
    if (el === lastHighlighted) return;
    if (lastHighlighted) lastHighlighted.classList.remove('opencode-inspect-highlight');
    el.classList.add('opencode-inspect-highlight');
    lastHighlighted = el;
  }

  function inspectOut(e) {
    if (!inspectActive) return;
    if (lastHighlighted) lastHighlighted.classList.remove('opencode-inspect-highlight');
    lastHighlighted = null;
  }

  function inspectClick(e) {
    if (!inspectActive) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var selector = el.tagName.toLowerCase();
    if (el.id) selector += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      selector += '.' + el.className.trim().split(/\\s+/).join('.');
    }
    parent.postMessage({
      type: 'element-selected',
      selector: selector,
      tagName: el.tagName.toLowerCase(),
      textContent: (el.textContent || '').slice(0, 100)
    }, '*');
    toggleInspect(false);
  }

  function toggleInspect(enabled) {
    inspectActive = enabled;
    if (enabled) {
      document.addEventListener('mouseover', inspectOver, true);
      document.addEventListener('mouseout', inspectOut, true);
      document.addEventListener('click', inspectClick, true);
      document.body.style.cursor = 'crosshair';
    } else {
      document.removeEventListener('mouseover', inspectOver, true);
      document.removeEventListener('mouseout', inspectOut, true);
      document.removeEventListener('click', inspectClick, true);
      document.body.style.cursor = '';
      if (lastHighlighted) {
        lastHighlighted.classList.remove('opencode-inspect-highlight');
        lastHighlighted = null;
      }
    }
  }

  // === Global error handler ===
  window.onerror = function(msg, source, line, col, error) {
    showError(msg + (line ? ' (line ' + line + ')' : ''));
  };
  window.addEventListener('unhandledrejection', function(e) {
    showError('Unhandled promise rejection: ' + (e.reason?.message || e.reason || 'Unknown'));
  });

  // Signal ready
  parent.postMessage({ type: 'ready' }, '*');
})();
</script>
</body>
</html>`
}
