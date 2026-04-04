export function createInjectionScript(): string {
  return `
(function() {
  if (window.__opencode_design_injected) return;
  window.__opencode_design_injected = true;

  function init() {
    var overlay = document.createElement('div');
    overlay.id = '__opencode_hover_overlay';
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #3b82f6;border-radius:2px;display:none;transition:all 0.05s ease;';
    document.body.appendChild(overlay);

    var selected = document.createElement('div');
    selected.id = '__opencode_selected_overlay';
    selected.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #8b5cf6;border-radius:2px;background:rgba(139,92,246,0.08);display:none;';
    document.body.appendChild(selected);

    var label = document.createElement('div');
    label.id = '__opencode_element_label';
    label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1e1b4b;color:#e0e7ff;font-size:11px;font-family:monospace;padding:2px 6px;border-radius:3px;display:none;white-space:nowrap;';
    document.body.appendChild(label);

    // Comment button near selected element — bridges to main webview
    var commentBtn = document.createElement('button');
    commentBtn.id = '__opencode_comment_btn';
    commentBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>';
    commentBtn.style.cssText = 'position:fixed;z-index:2147483647;display:none;width:28px;height:28px;border-radius:6px;border:2px solid #7c3aed;background:#7c3aed;color:#ffffff;cursor:pointer;padding:0;box-shadow:0 2px 10px rgba(0,0,0,0.5);transition:background 0.1s,border-color 0.1s;';
    commentBtn.title = 'Add comment';
    commentBtn.addEventListener('mouseenter', function() { commentBtn.style.background = '#6d28d9'; commentBtn.style.borderColor = '#6d28d9'; });
    commentBtn.addEventListener('mouseleave', function() { commentBtn.style.background = '#7c3aed'; commentBtn.style.borderColor = '#7c3aed'; });
    document.body.appendChild(commentBtn);

    var openBtn = document.createElement('button');
    openBtn.id = '__opencode_open_btn';
    openBtn.textContent = 'Open';
    openBtn.style.cssText = 'position:fixed;z-index:2147483647;display:none;align-items:center;justify-content:center;height:28px;min-width:46px;border-radius:6px;border:2px solid rgba(255,255,255,0.16);background:rgba(17,17,17,0.94);color:#ffffff;cursor:pointer;padding:0 8px;box-sizing:border-box;box-shadow:0 2px 10px rgba(0,0,0,0.5);transition:background 0.1s,border-color 0.1s;font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;appearance:none;-webkit-appearance:none;';
    openBtn.title = 'Open';
    openBtn.addEventListener('mouseenter', function() { openBtn.style.background = '#27272a'; openBtn.style.borderColor = 'rgba(255,255,255,0.28)'; });
    openBtn.addEventListener('mouseleave', function() { openBtn.style.background = 'rgba(17,17,17,0.94)'; openBtn.style.borderColor = 'rgba(255,255,255,0.16)'; });
    document.body.appendChild(openBtn);

    var commentBox = document.createElement('div');
    commentBox.id = '__opencode_comment_box';
    commentBox.style.cssText = 'position:fixed;z-index:2147483647;display:none;width:320px;max-width:calc(100vw - 16px);border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(23,23,23,0.98);box-shadow:0 16px 48px rgba(0,0,0,0.45);padding:8px;box-sizing:border-box;';
    document.body.appendChild(commentBox);

    var commentInput = document.createElement('textarea');
    commentInput.style.cssText = 'width:100%;min-height:92px;box-sizing:border-box;resize:vertical;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#161616;color:#f5f5f5;font-size:12px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    commentInput.placeholder = 'Add comment';
    commentBox.appendChild(commentInput);

    var commentMeta = document.createElement('div');
    commentMeta.style.cssText = 'margin-top:8px;color:rgba(255,255,255,0.56);font-size:11px;line-height:1.4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    commentBox.appendChild(commentMeta);

    var commentActions = document.createElement('div');
    commentActions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px;';
    commentBox.appendChild(commentActions);

    var commentCancel = document.createElement('button');
    commentCancel.type = 'button';
    commentCancel.textContent = 'Cancel';
    commentCancel.style.cssText = 'height:28px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:rgba(255,255,255,0.8);font-size:12px;cursor:pointer;';
    commentActions.appendChild(commentCancel);

    var commentSubmit = document.createElement('button');
    commentSubmit.type = 'button';
    commentSubmit.textContent = 'Comment';
    commentSubmit.style.cssText = 'height:28px;padding:0 10px;border-radius:8px;border:1px solid #f5f5f5;background:#f5f5f5;color:#111111;font-size:12px;font-weight:600;cursor:pointer;';
    commentActions.appendChild(commentSubmit);

    function isOverlay(el) {
      return el === overlay || el === selected || el === label || el === commentBtn || el === openBtn || el === commentBox || (el && el.closest && (el.closest('#__opencode_comment_btn') || el.closest('#__opencode_open_btn') || el.closest('#__opencode_comment_box')));
    }

    function domPath(el) {
      var parts = [];
      var node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        var tag = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(tag + '#' + node.id);
          break;
        }
        var parent = node.parentElement;
        if (parent) {
          var children = Array.from(parent.children).filter(function(c) { return c.tagName === node.tagName; });
          if (children.length > 1) {
            var idx = children.indexOf(node) + 1;
            tag += ':nth-of-type(' + idx + ')';
          }
        }
        parts.unshift(tag);
        node = parent;
      }
      return parts.join(' > ');
    }

    function stripPath(f) {
      if (!f) return f;
      // Remove query strings (?t=123, ?v=abc, ?import, etc.)
      f = f.replace(/\\?[^:]*$/, '');
      // turbopack://[project]/src/app/page.tsx → src/app/page.tsx
      f = f.replace(/^turbopack:\\/\\/\\[project\\]\\//, '');
      // webpack-internal:///./src/app/page.tsx → src/app/page.tsx
      f = f.replace(/^webpack-internal:\\/\\/\\/\\.?\\//, '');
      // webpack:///./src/app/page.tsx → src/app/page.tsx
      f = f.replace(/^webpack:\\/\\/\\/\\.?\\//, '');
      // webpack://app-name/./src/... → src/...
      f = f.replace(/^webpack:\\/\\/[^/]*\\/\\.?\\//, '');
      // (app-pages-browser)/./src/... → src/...
      f = f.replace(/^\\(.*?\\)\\/\\.?\\//, '');
      // Vite: /@fs/absolute/path → /absolute/path
      f = f.replace(/^\\/@fs/, '');
      // Vite: /@id/ or /@vite/ prefixes
      f = f.replace(/^\\/@(id|vite)\\//, '');
      // file:// protocol
      f = f.replace(/^file:\\/\\//, '');
      // http://localhost:PORT/src/... → src/...
      f = f.replace(/^https?:\\/\\/[^/]+\\//, '');
      // Remove leading ./ if present
      f = f.replace(/^\\.?\\//, '');
      f = f.replace(/\\\\/g, '/');
      return f;
    }

    var SKIP_PATTERNS = ['node_modules', '.vite/deps', '.vite/chunks', '.pnpm/', '.yarn/cache', 'react-dom', 'react.', 'webpack/runtime', 'turbopack-runtime', 'next/dist', 'scheduler.', 'react-refresh', 'hot-update', '__vite', 'svelte-hmr', 'vue-hot-reload', 'chunk-', '@vite/client'];

    function shouldSkip(file) {
      if (!file) return true;
      for (var i = 0; i < SKIP_PATTERNS.length; i++) {
        if (file.indexOf(SKIP_PATTERNS[i]) !== -1) return true;
      }
      return isBundled(file);
    }

    function isBundled(file) {
      if (!file) return false;
      var name = file.split('/').pop() || '';
      // Hashed chunk files: abc123.js, 0a3f.js, main-abc123.js, layout-[hash].js
      if (/^[0-9a-f]{4,}\.(js|mjs)$/.test(name)) return true;
      if (/^(main|app|vendor|framework|commons|webpack|polyfills?)-[0-9a-f]+\.(js|mjs)$/.test(name)) return true;
      if (/\.[0-9a-f]{6,}\.(js|mjs)$/.test(name)) return true;
      // Next.js/turbopack chunks
      if (file.indexOf('static/chunks/') !== -1) return true;
      if (file.indexOf('_next/') !== -1) return true;
      if (file.indexOf('.next/') !== -1) return true;
      // Vite pre-bundled deps
      if (file.indexOf('.vite/deps/') !== -1) return true;
      if (file.indexOf('.vite/chunks/') !== -1) return true;
      // Generic build output dirs
      if (file.indexOf('/dist/') !== -1 && name.indexOf('.') !== -1 && !/\.(tsx?|jsx?|vue|svelte)$/.test(name)) return true;
      if (file.indexOf('/build/static/') !== -1) return true;
      return false;
    }

    function parseStack(stack) {
      if (!stack) return null;
      var str = typeof stack === 'string' ? stack : (stack.stack || String(stack));
      var lines = str.split('\\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        // Chrome/V8: at ComponentName (file:line:col) or at file:line:col
        var m = line.match(/at\\s+(?:(\\S+)\\s+)?\\(?(.+?):(\\d+):(\\d+)\\)?/);
        if (m && !shouldSkip(m[2])) {
          return { file: stripPath(m[2]), line: parseInt(m[3], 10), column: parseInt(m[4], 10), component: m[1] || undefined };
        }
        // Firefox/Safari: ComponentName@file:line:col or file:line:col
        var ff = line.match(/^(?:([^@]*)@)?(.+?):(\\d+):(\\d+)\\s*$/);
        if (ff && !shouldSkip(ff[2])) {
          return { file: stripPath(ff[2]), line: parseInt(ff[3], 10), column: parseInt(ff[4], 10), component: ff[1] || undefined };
        }
      }
      return null;
    }

    function fiberName(fiber) {
      if (!fiber || !fiber.type) return null;
      var t = fiber.type;
      // Direct function component
      if (typeof t === 'function') return t.displayName || t.name || null;
      // forwardRef: { $$typeof, render }
      if (t.render && typeof t.render === 'function') return t.render.displayName || t.render.name || null;
      // memo: { $$typeof, type }
      if (t.type && typeof t.type === 'function') return t.type.displayName || t.type.name || null;
      return null;
    }

    function hasLibraryIndicator(raw) {
      if (!raw) return false;
      if (raw.indexOf('node_modules') !== -1) return true;
      if (raw.indexOf('.vite/deps') !== -1) return true;
      if (raw.indexOf('.vite/chunks') !== -1) return true;
      if (raw.indexOf('.pnpm/') !== -1) return true;
      if (raw.indexOf('.yarn/cache') !== -1) return true;
      if (raw.indexOf('/dist/') !== -1) return true;
      if (raw.indexOf('/build/') !== -1) return true;
      if (raw.indexOf('.next/') !== -1) return true;
      if (raw.indexOf('_next/') !== -1) return true;
      if (raw.indexOf('static/chunks/') !== -1) return true;
      return false;
    }

    // Returns 'lib' if fiber source is in node_modules/library, 'user' if in user code, null if unknown
    function fiberOrigin(fiber) {
      // Check direct debug info
      if (fiber._debugSource) {
        var raw = fiber._debugSource.fileName;
        if (hasLibraryIndicator(raw)) return 'lib';
        var f = stripPath(raw);
        return shouldSkip(f) ? 'lib' : 'user';
      }
      if (fiber._debugStack) {
        var p = parseStack(fiber._debugStack);
        if (p) return shouldSkip(p.file) ? 'lib' : 'user';
      }
      // Check owner debug info
      if (fiber._debugOwner) {
        if (fiber._debugOwner._debugSource) {
          var owRaw = fiber._debugOwner._debugSource.fileName;
          if (hasLibraryIndicator(owRaw)) return 'lib';
          var owf = stripPath(owRaw);
          return shouldSkip(owf) ? 'lib' : 'user';
        }
        if (fiber._debugOwner._debugStack) {
          var ows = parseStack(fiber._debugOwner._debugStack);
          if (ows) return shouldSkip(ows.file) ? 'lib' : 'user';
        }
      }
      return null;
    }

    // User component whitelist — populated from main webview after project scan.
    // Once loaded, ONLY whitelisted names are treated as user components.
    // This replaces a static blocklist: we scan the project for real components instead.
    var userComponents = null;

    function isLibName(name) {
      // Obvious non-component patterns
      if (name.startsWith('$')) return true;
      if (/^(motion|m)\.[a-z]/.test(name)) return true;
      // Whitelist-based: if loaded, anything not in it is library code
      if (userComponents) return !userComponents[name];
      // No whitelist yet — let fiberOrigin decide (don't block anything by name)
      return false;
    }

    var componentMap = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var resolvedSources = {};
    var unresolvedNames = {};
    var mapBuilt = false;
    var mapDirty = true;
    var mapTimer = 0;
    var mapIdle = 0;
    var mapSync = false;

    function fiberKey(el) {
      var keys = Object.keys(el);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) return keys[i];
      }
      return null;
    }

    function extractSource(fiber) {
      if (fiber._debugSource) {
        var raw = fiber._debugSource.fileName;
        if (!hasLibraryIndicator(raw)) {
          var f = stripPath(raw);
          if (!shouldSkip(f)) return { file: f, line: fiber._debugSource.lineNumber, column: fiber._debugSource.columnNumber };
        }
      }
      if (fiber._debugOwner && fiber._debugOwner._debugSource) {
        var owRaw = fiber._debugOwner._debugSource.fileName;
        if (!hasLibraryIndicator(owRaw)) {
          var owf = stripPath(owRaw);
          if (!shouldSkip(owf)) return { file: owf, line: fiber._debugOwner._debugSource.lineNumber, column: fiber._debugOwner._debugSource.columnNumber };
        }
      }
      if (fiber._debugStack) {
        var p = parseStack(fiber._debugStack);
        if (p && !shouldSkip(p.file)) return { file: p.file, line: p.line, column: p.column };
      }
      if (fiber._debugOwner && fiber._debugOwner._debugStack) {
        var ows = parseStack(fiber._debugOwner._debugStack);
        if (ows && !shouldSkip(ows.file)) return { file: ows.file, line: ows.line, column: ows.column };
      }
      return null;
    }

    function analyzeChildren(root) {
      var counts = {};
      var heading = '';
      var interactive = 0;
      var media = 0;
      var tags = ['h1','h2','h3','h4','h5','h6','p','button','a','img','video','canvas','input','form','ul','ol','li','table','textarea','select'];
      var walk = document.createTreeWalker(root, 1);
      var node;
      var depth = 0;
      while ((node = walk.nextNode()) && depth < 500) {
        depth++;
        var tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (tags.indexOf(tag) !== -1) {
          counts[tag] = (counts[tag] || 0) + 1;
          if (!heading && /^h[1-6]$/.test(tag)) {
            var txt = (node.textContent || '').trim();
            if (txt) heading = txt.length > 50 ? txt.slice(0, 50) + '…' : txt;
          }
          if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') interactive++;
          if (tag === 'img' || tag === 'video' || tag === 'canvas') media++;
        }
      }
      var parts = [];
      if (heading) parts.push('heading "' + heading + '"');
      var li = (counts['li'] || 0);
      if (li > 1) parts.push(li + ' list items');
      var form = counts['form'] || 0;
      var inputs = (counts['input'] || 0) + (counts['textarea'] || 0) + (counts['select'] || 0);
      if (form && inputs) parts.push('form with ' + inputs + ' fields');
      else if (inputs > 1) parts.push(inputs + ' input fields');
      var btns = counts['button'] || 0;
      if (btns) parts.push(btns + ' button' + (btns > 1 ? 's' : ''));
      var links = counts['a'] || 0;
      if (links > 1) parts.push(links + ' links');
      if (media) parts.push(media + ' media');
      var tbl = counts['table'] || 0;
      if (tbl) parts.push('table');
      var para = counts['p'] || 0;
      if (para > 1) parts.push(para + ' paragraphs');
      return parts.length > 0 ? parts.join(', ') : '';
    }

    function buildComponentMap() {
      if (!componentMap || !document.body) return;
      unresolvedNames = {};
      var count = 0;
      var walker = document.createTreeWalker(document.body, 1);
      var el;
      while ((el = walker.nextNode())) {
        if (el.id && el.id.indexOf('__opencode_') === 0) continue;
        var fk = fiberKey(el);
        if (fk) {
          var fiber = el[fk];
          var name = null;
          var chain = [];
          var file = null;
          var line = null;
          var col = null;
          var seen = {};
          var depth = 0;
          var fallback = null;
          while (fiber && depth < 40) {
            var fn = fiberName(fiber);
            if (fn && fn !== 'anon' && fn.length > 1 && fn[0] === fn[0].toUpperCase() && !isLibName(fn)) {
              var origin = fiberOrigin(fiber);
              if (isUserName(fn, origin)) {
                if (!name && (origin === 'user' || (userComponents && userComponents[fn]))) {
                  name = fn;
                  var src = extractSource(fiber);
                  if (src) { file = src.file; line = src.line; col = src.column; }
                } else if (!name && !fallback) {
                  fallback = fn;
                }
                if (!seen[fn]) { seen[fn] = 1; chain.push(fn); }
              }
            }
            depth++;
            fiber = fiber.return;
          }
          if (!name) name = fallback;
          if (name) {
            if (!file && resolvedSources[name]) {
              file = resolvedSources[name].file || resolvedSources[name];
              line = resolvedSources[name].line || 1;
            }
            componentMap.set(el, { name: name, chain: chain, file: file, line: line, column: col });
            count++;
            if (!file && !unresolvedNames[name]) unresolvedNames[name] = 1;
          }
          continue;
        }
        if (el.__vue__) {
          var opts = el.__vue__.$options;
          var vn = opts.name || opts._componentTag;
          if (vn && vn[0] === vn[0].toUpperCase()) {
            componentMap.set(el, { name: vn, chain: [vn], file: opts.__file || null, line: 1, column: null });
            count++;
            if (!opts.__file && !unresolvedNames[vn]) unresolvedNames[vn] = 1;
          }
          continue;
        }
        if (el.__vueParentComponent) {
          var vt = el.__vueParentComponent.type;
          var v3 = vt && (vt.name || vt.__name);
          if (v3 && v3[0] === v3[0].toUpperCase()) {
            componentMap.set(el, { name: v3, chain: [v3], file: vt.__file || null, line: 1, column: null });
            count++;
            if (!vt.__file && !unresolvedNames[v3]) unresolvedNames[v3] = 1;
          }
          continue;
        }
        if (el.__svelte_meta && el.__svelte_meta.loc) {
          var loc = el.__svelte_meta.loc;
          var sn = (loc.file || '').split('/').pop().replace(/\\.svelte$/, '');
          if (sn && sn[0] === sn[0].toUpperCase()) {
            componentMap.set(el, { name: sn, chain: [sn], file: loc.file, line: loc.line, column: loc.column });
            count++;
          }
          continue;
        }
      }
      mapBuilt = true;
      console.log('[Design] Component map built:', count, 'elements mapped');
      var names = Object.keys(unresolvedNames);
      if (names.length > 0) {
        console.log('[Design] Requesting resolution for', names.length, 'components without source');
        post('component-list', { names: names });
      }
    }

    function runMap() {
      mapTimer = 0;
      mapIdle = 0;
      if (!mapDirty || !componentMap || !document.body) return;
      if (!inspectMode && mapBuilt) return;
      mapDirty = false;
      buildComponentMap();
      if (!currentEl) {
        mapSync = false;
        return;
      }
      currentInfo = info(currentEl);
      if (!mapSync) return;
      mapSync = false;
      post('element-select', currentInfo);
    }

    function queueMap(delay) {
      if (!componentMap) return;
      mapDirty = true;
      if (!inspectMode && mapBuilt) return;
      if (mapTimer) clearTimeout(mapTimer);
      if (mapIdle && window.cancelIdleCallback) {
        window.cancelIdleCallback(mapIdle);
        mapIdle = 0;
      }
      mapTimer = setTimeout(function() {
        mapTimer = 0;
        if (window.requestIdleCallback) {
          mapIdle = window.requestIdleCallback(runMap, { timeout: 500 });
          return;
        }
        runMap();
      }, delay || 0);
    }

    function mapLookup(el) {
      if (!componentMap) return null;
      var node = el;
      var depth = 0;
      while (node && node !== document.body && depth < 20) {
        var entry = componentMap.get(node);
        if (entry) {
          if (!entry.file && resolvedSources[entry.name]) {
            entry.file = resolvedSources[entry.name].file || resolvedSources[entry.name];
            entry.line = resolvedSources[entry.name].line || 1;
          }
          return entry;
        }
        node = node.parentElement;
        depth++;
      }
      return null;
    }

    // Returns true if name should be treated as a user component
    function isUserName(name, origin) {
      // Whitelist loaded: trust it — if name passed isLibName, it's in the whitelist
      if (userComponents) return true;
      // No whitelist: rely on fiber origin
      if (origin === 'user') return true;
      if (origin === 'lib') return false;
      // Unknown origin, no whitelist — include as fallback
      return true;
    }

    function componentName(el) {
      var entry = mapLookup(el);
      if (entry) return entry.name;
      var fk = fiberKey(el);
      if (!fk) return null;
      var fiber = el[fk];
      var depth = 0;
      var fallback = null;
      while (fiber && depth < 30) {
        var name = fiberName(fiber);
        if (name && name !== 'anon' && name.length > 1 && name[0] === name[0].toUpperCase() && !isLibName(name)) {
          var origin = fiberOrigin(fiber);
          if (origin === 'user') return name;
          if (isUserName(name, origin) && !fallback) fallback = name;
        }
        depth++;
        fiber = fiber.return;
      }
      return fallback;
    }

    // Collect full component ancestry: [nearest, ..., outermost]
    function componentAncestry(el) {
      var entry = mapLookup(el);
      if (entry) return entry.chain;
      var fk = fiberKey(el);
      if (!fk) return [];
      var fiber = el[fk];
      var depth = 0;
      var result = [];
      var seen = {};
      while (fiber && depth < 40) {
        var name = fiberName(fiber);
        if (name && name !== 'anon' && name.length > 1 && name[0] === name[0].toUpperCase() && !isLibName(name)) {
          var origin = fiberOrigin(fiber);
          if (isUserName(name, origin) && !seen[name]) {
            seen[name] = 1;
            result.push(name);
          }
        }
        depth++;
        fiber = fiber.return;
      }
      return result;
    }

    function fiberDebugKeys(fiber) {
      if (!fiber) return {};
      var out = {};
      var all = Object.getOwnPropertyNames(fiber);
      for (var i = 0; i < all.length; i++) {
        var k = all[i];
        if (k.indexOf('debug') !== -1 || k.indexOf('Debug') !== -1) {
          var v = fiber[k];
          if (v === null) out[k] = 'null';
          else if (v === undefined) out[k] = 'undefined';
          else if (typeof v === 'string') out[k] = v.slice(0, 300);
          else if (typeof v === 'object' && v.stack) out[k] = '[Error] ' + String(v.stack).slice(0, 300);
          else out[k] = typeof v;
        }
      }
      return out;
    }

    function findSource(el) {
      var entry = mapLookup(el);
      if (entry && entry.file) {
        return { file: entry.file, line: entry.line, column: entry.column, component: entry.name, _debug: ['map'] };
      }
      var log = [];

      var tag = el.tagName.toLowerCase();
      var cls = el.className && typeof el.className === 'string' ? el.className.trim() : '';
      log.push('[Design] Clicked element: <' + tag + (cls ? ' class="' + cls.split(/[ \t]+/).slice(0,3).join(' ') + '"' : '') + '>');

      var debugLines = [];

      // 0. Check data-source-file attribute (some build tools inject this)
      var srcAttr = el.getAttribute('data-source-file');
      if (srcAttr) {
        log.push('[Design] FOUND data-source-file: ' + srcAttr);
        var parts = srcAttr.split(':');
        postDebugLog(log);
        return {
          file: stripPath(parts[0]),
          line: parts[1] ? parseInt(parts[1], 10) : 1,
          column: parts[2] ? parseInt(parts[2], 10) : undefined,
          component: componentName(el),
          _debug: debugLines
        };
      }

      // 1. React: find fiber on this DOM element, walk UP the fiber tree
      var keys = Object.keys(el);
      var reactKey = fiberKey(el);

      // Helper: try to extract a user-code source from a single fiber node
      function tryFiber(fb) {
        if (fb._debugSource) {
          var raw = fb._debugSource.fileName;
          if (hasLibraryIndicator(raw)) {
            log.push('[Design]   _debugSource raw skipped: ' + raw);
          } else {
            var f = stripPath(raw);
            if (!shouldSkip(f)) return { file: f, line: fb._debugSource.lineNumber, column: fb._debugSource.columnNumber, component: fiberName(fb) };
            log.push('[Design]   _debugSource skipped: ' + f);
          }
        }
        if (fb._debugOwner && fb._debugOwner._debugSource) {
          var owRaw = fb._debugOwner._debugSource.fileName;
          if (hasLibraryIndicator(owRaw)) {
            log.push('[Design]   _debugOwner._debugSource raw skipped: ' + owRaw);
          } else {
            var owf = stripPath(owRaw);
            if (!shouldSkip(owf)) return { file: owf, line: fb._debugOwner._debugSource.lineNumber, column: fb._debugOwner._debugSource.columnNumber, component: fiberName(fb) || fiberName(fb._debugOwner) };
            log.push('[Design]   _debugOwner._debugSource skipped: ' + owf);
          }
        }
        if (fb._debugStack) {
          var p = parseStack(fb._debugStack);
          if (p && !shouldSkip(p.file)) { if (!p.component) p.component = fiberName(fb); return p; }
          if (p) log.push('[Design]   _debugStack skipped: ' + p.file);
        }
        if (fb._debugOwner && fb._debugOwner._debugStack) {
          var ows = parseStack(fb._debugOwner._debugStack);
          if (ows && !shouldSkip(ows.file)) { if (!ows.component) ows.component = fiberName(fb._debugOwner) || fiberName(fb); return ows; }
          if (ows) log.push('[Design]   _debugOwner._debugStack skipped: ' + ows.file);
        }
        if (fb._debugInfo && Array.isArray(fb._debugInfo)) {
          for (var di = 0; di < fb._debugInfo.length; di++) {
            var entry = fb._debugInfo[di];
            if (entry && entry.owner && entry.owner._debugSource) {
              var df = stripPath(entry.owner._debugSource.fileName);
              if (!shouldSkip(df)) return { file: df, line: entry.owner._debugSource.lineNumber, column: entry.owner._debugSource.columnNumber, component: entry.owner.name || entry.name || fiberName(fb) };
              log.push('[Design]   _debugInfo[' + di + '] skipped: ' + df);
            }
            if (entry && entry.owner && entry.owner._debugStack) {
              var ip = parseStack(entry.owner._debugStack);
              if (ip && !shouldSkip(ip.file)) { if (!ip.component) ip.component = entry.owner.name || entry.name; return ip; }
            }
          }
        }
        return null;
      }

      if (reactKey) {
        log.push('[Design] Fiber key found: ' + reactKey);
        log.push('[Design] Walking fiber tree:');
        var fiber = el[reactKey];
        var depth = 0;
        var fallbackSrc = null;

        while (fiber && depth < 30) {
          var typeName = fiberName(fiber) || (typeof fiber.type === 'string' ? fiber.type : '?');
          log.push('[Design]   depth=' + depth + ' type=' + typeName);
          debugLines.push('d' + depth + ':' + typeName);

          var src = tryFiber(fiber);
          if (src) {
            var origin = fiberOrigin(fiber);
            var userComp = componentName(el);
            src.component = userComp || src.component;
            src._debug = debugLines;
            if (origin === 'user') {
              log.push('[Design]   FOUND user source: ' + src.file + ':' + src.line + ' component=' + src.component);
              postDebugLog(log);
              return src;
            }
            if (!fallbackSrc) {
              fallbackSrc = src;
              log.push('[Design]   stashed non-user source: ' + src.file + ':' + src.line + ' origin=' + origin);
            }
          }

          depth++;
          fiber = fiber.return;
        }
        if (fallbackSrc) {
          log.push('[Design]   returning fallback source: ' + fallbackSrc.file);
          postDebugLog(log);
          return fallbackSrc;
        }
        log.push('[Design]   Fiber walk exhausted at depth=' + depth + ', no source found');
      } else {
        log.push('[Design] No fiber key found on element — checking for React keys: ' + keys.filter(function(k){ return k.startsWith('__react'); }).join(', '));
        debugLines.push('no-fiber:' + el.tagName);
      }

      // 2. Try parent DOM elements
      var node = el.parentElement;
      var pd = 0;
      while (node && node !== document.body && node !== document.documentElement && pd < 10) {
        var pkeys = Object.keys(node);
        for (var j = 0; j < pkeys.length; j++) {
          if (pkeys[j].startsWith('__reactFiber$') || pkeys[j].startsWith('__reactInternalInstance$')) {
            var pfiber = node[pkeys[j]];
            while (pfiber) {
              var psrc = tryFiber(pfiber);
              if (psrc) {
                var pcomp = componentName(el);
                psrc.component = pcomp || psrc.component;
                psrc._debug = debugLines;
                log.push('[Design]   FOUND via parent DOM: ' + psrc.file + ':' + psrc.line);
                postDebugLog(log);
                return psrc;
              }
              pfiber = pfiber.return;
            }
            break;
          }
        }
        pd++;
        node = node.parentElement;
      }

      // 3. Vue
      node = el;
      while (node && node !== document.body) {
        if (node.__vue__) {
          var opts = node.__vue__.$options;
          if (opts && opts.__file) {
            log.push('[Design] FOUND Vue __file: ' + opts.__file);
            postDebugLog(log);
            return { file: opts.__file, line: 1, _debug: debugLines };
          }
        }
        if (node.__vueParentComponent) {
          var vtype = node.__vueParentComponent.type;
          if (vtype && vtype.__file) {
            log.push('[Design] FOUND Vue __vueParentComponent.__file: ' + vtype.__file);
            postDebugLog(log);
            return { file: vtype.__file, line: 1, _debug: debugLines };
          }
        }
        node = node.parentElement;
      }

      // 4. Svelte
      node = el;
      while (node && node !== document.body) {
        if (node.__svelte_meta) {
          var loc = node.__svelte_meta.loc;
          if (loc) {
            log.push('[Design] FOUND Svelte __svelte_meta: ' + loc.file + ':' + loc.line);
            postDebugLog(log);
            return { file: loc.file, line: loc.line, column: loc.column, _debug: debugLines };
          }
        }
        node = node.parentElement;
      }

      log.push('[Design] No source found anywhere');
      postDebugLog(log);
      return { _debug: debugLines };
    }

    function postDebugLog(lines) {
      try {
        var ti = window.__TAURI_INTERNALS__;
        if (ti && ti.invoke) {
          ti.invoke('design_bridge', { event: 'design:debug-source', payload: JSON.stringify({ log: lines }) }).catch(function() {});
        }
      } catch(e) {}
    }

    function framework() {
      if (window.__NEXT_DATA__) return 'nextjs';
      if (window.__NUXT__ || document.querySelector('[data-v-]')) return 'vue';
      if (document.querySelector('[class*="svelte-"]')) return 'svelte';
      return null;
    }

    function searchHint(el) {
      var hints = [];
      // data-testid is a strong, unique identifier
      var testid = el.getAttribute('data-testid');
      if (testid) hints.push(testid);
      // data-source-file (some tooling adds this)
      var srcFile = el.getAttribute('data-source-file');
      if (srcFile) hints.push(srcFile);
      // React component name is a great search term
      var comp = componentName(el);
      if (comp) hints.push(comp);
      // aria-label often contains unique text
      var aria = el.getAttribute('aria-label');
      if (aria && aria.length > 2) hints.push(aria);
      if (el.id) hints.push('#' + el.id);
      if (el.className && typeof el.className === 'string') {
        var cls = el.className.trim().split(/\\s+/);
        for (var i = 0; i < Math.min(cls.length, 3); i++) {
          if (cls[i] && cls[i].length > 2) hints.push(cls[i]);
        }
      }
      var text = directText(el);
      if (text && text.length > 3) hints.push(text);
      return hints.length ? hints : undefined;
    }

    var STYLE_KEYS = [
      'display','position','width','height','margin','padding',
      'color','backgroundColor','fontSize','fontWeight',
      'border','borderRadius','flexDirection','alignItems',
      'justifyContent','gap','opacity','overflow','zIndex','boxShadow'
    ];
    var NOISE = {'none':1,'normal':1,'auto':1,'0px':1,'rgba(0, 0, 0, 0)':1,'start':1,'stretch':1,'':1,'visible':1,'static':1,'1':1};

    function styles(el) {
      var cs = window.getComputedStyle(el);
      var out = {};
      for (var i = 0; i < STYLE_KEYS.length; i++) {
        var k = STYLE_KEYS[i];
        var v = cs[k];
        if (v && !NOISE[v]) out[k] = v;
      }
      return out;
    }

    function directText(el) {
      // Get only the element's own text nodes, not deep children
      var parts = [];
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) {
          var t = el.childNodes[i].textContent.trim();
          if (t) parts.push(t);
        }
      }
      if (parts.length) return parts.join(' ').slice(0, 60);
      // Fall back to innerText if no direct text nodes but element is a leaf
      if (el.children.length === 0 && el.textContent) return el.textContent.trim().slice(0, 60);
      return null;
    }

    function info(el) {
      var rect = el.getBoundingClientRect();
      var src = findSource(el);
      var comp = src && src.component ? src.component : componentName(el);
      var text = directText(el);
      var ancestors = componentAncestry(el);
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        classes: el.className && typeof el.className === 'string' ? el.className.trim() || undefined : undefined,
        component: comp || undefined,
        textContent: text || undefined,
        ancestry: ancestors.length > 0 ? ancestors : undefined,
        summary: comp ? analyzeChildren(el) : undefined,
        path: domPath(el),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: styles(el),
        source: src,
        searchHint: searchHint(el),
        framework: framework()
      };
    }

    var currentEl = null;
    var currentInfo = null;
    var hoverEl = null;
    var hoverX = 0;
    var hoverY = 0;
    var hoverFrame = 0;
    var syncFrame = 0;
    var inspectMode = true;
    document.body.style.cursor = 'crosshair';

    function readInfo(el, force) {
      if (!el) return null;
      if (!force && currentEl === el && currentInfo) {
        var rect = el.getBoundingClientRect();
        currentInfo.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        return currentInfo;
      }
      currentInfo = info(el);
      return currentInfo;
    }

    function selectElement(el) {
      hideCommentBox();
      currentEl = el;
      currentInfo = readInfo(el, true);
      syncSelection();
      return currentInfo;
    }

    function syncSelection() {
      if (!inspectMode || !currentEl) return;
      currentInfo = readInfo(currentEl);
      showOverlay(currentEl, selected);
      positionActionBtns(currentEl);
      if (commentBox.style.display === 'block') positionCommentBox(currentEl);
    }

    function queueSelection() {
      if (syncFrame) return;
      syncFrame = requestAnimationFrame(function() {
        syncFrame = 0;
        syncSelection();
      });
    }

    function applyHover() {
      hoverFrame = 0;
      if (!inspectMode) {
        hoverEl = null;
        overlay.style.display = 'none';
        label.style.display = 'none';
        return;
      }
      var el = document.elementFromPoint(hoverX, hoverY);
      if (!el || isOverlay(el)) {
        hoverEl = null;
        overlay.style.display = 'none';
        label.style.display = 'none';
        return;
      }
      if (el === hoverEl) return;
      hoverEl = el;
      showOverlay(el, overlay);
      showLabel(el);
    }

    function post(type, payload) {
      try {
        var data = JSON.stringify(payload || {});
        var ti = window.__TAURI_INTERNALS__;
        if (ti && ti.invoke) {
          ti.invoke('design_bridge', { event: 'design:' + type, payload: data }).catch(function() {});
          return;
        }
        var ev = window.__TAURI__ && window.__TAURI__.event;
        if (ev && ev.emit) {
          ev.emit('design:' + type, data).catch(function() {});
        }
      } catch(e) {}
    }

    // Exposed for main webview to call via eval_design_webview
    window.__opencode_set_inspect_mode = function(enabled) {
      inspectMode = !!enabled;
        if (!inspectMode) {
          hoverEl = null;
          overlay.style.display = 'none';
          selected.style.display = 'none';
          label.style.display = 'none';
          commentBtn.style.display = 'none';
          openBtn.style.display = 'none';
          hideCommentBox(false);
          document.body.style.cursor = '';
        } else {
          document.body.style.cursor = 'crosshair';
          if (mapDirty || !mapBuilt) queueMap();
          syncSelection();
        }
      };

    window.__opencode_clear_selection = function() {
      currentEl = null;
      currentInfo = null;
      hoverEl = null;
      selected.style.display = 'none';
      overlay.style.display = 'none';
      label.style.display = 'none';
      commentBtn.style.display = 'none';
      openBtn.style.display = 'none';
      if (syncFrame) cancelAnimationFrame(syncFrame);
      syncFrame = 0;
      hideCommentBox();
    };



    window.__opencode_set_user_components = function(names) {
      if (!names || !names.length) {
        userComponents = null;
        console.log('[Design] User component whitelist cleared');
        queueMap();
        return;
      }
      userComponents = {};
      for (var i = 0; i < names.length; i++) userComponents[names[i]] = 1;
      console.log('[Design] User component whitelist set:', names.length, 'components');
      queueMap();
    };

    window.__opencode_resolve_sources = function(map) {
      if (!map) return;
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        resolvedSources[keys[i]] = map[keys[i]];
        delete unresolvedNames[keys[i]];
      }
      if (currentEl) {
        currentInfo = readInfo(currentEl, true);
        queueSelection();
      }
      console.log('[Design] Resolved', keys.length, 'component sources from main webview');
    };

    window.__opencode_rebuild_map = function() {
      mapSync = true;
      queueMap();
    };

    window.__opencode_sync = function() {
      if (!inspectMode) return;
      syncSelection();
      if (hoverEl) {
        showOverlay(hoverEl, overlay);
        showLabel(hoverEl);
      }
    };


    var mapObserver = new MutationObserver(function(mutations) {
      var dominated = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length || mutations[i].removedNodes.length) { dominated = true; break; }
      }
      if (!dominated) return;
      queueMap(1500);
    });
    mapObserver.observe(document.body, { childList: true, subtree: true });

    queueMap(1500);

    function showOverlay(el, target) {
      var rect = el.getBoundingClientRect();
      target.style.left = rect.left + 'px';
      target.style.top = rect.top + 'px';
      target.style.width = rect.width + 'px';
      target.style.height = rect.height + 'px';
      target.style.display = 'block';
    }

    function showLabel(el) {
      var rect = el.getBoundingClientRect();
      var tag = el.tagName.toLowerCase();
      var comp = componentName(el);
      var text = '';
      if (comp) {
        text = '<' + comp + '>';
        if (tag !== comp.toLowerCase()) text += ' ' + tag;
      } else {
        text = '<' + tag;
        if (el.id) text += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          var cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
          if (cls) text += '.' + cls;
        }
        text += '>';
      }
      label.textContent = text;
      label.style.left = rect.left + 'px';
      label.style.top = Math.max(0, rect.top - 22) + 'px';
      label.style.display = 'block';
    }

    function positionActionBtns(el) {
      if (!inspectMode) return;
      var rect = el.getBoundingClientRect();
      var pad = 4;
      var gap = 6;
      var size = 28;
      var wide = Math.max(46, openBtn.offsetWidth || 46);
      var total = size + gap + wide;
      var left = Math.min(Math.max(pad, rect.right - total), Math.max(pad, window.innerWidth - total - pad));
      var top = rect.top - size - gap;
      if (top < pad) top = rect.top + gap;
      top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - size - pad));
      commentBtn.style.left = left + 'px';
      commentBtn.style.top = top + 'px';
      commentBtn.style.display = 'flex';
      commentBtn.style.alignItems = 'center';
      commentBtn.style.justifyContent = 'center';
      openBtn.style.left = (left + size + gap) + 'px';
      openBtn.style.top = top + 'px';
      openBtn.style.display = 'flex';
    }

    function hideCommentBox(clear) {
      commentBox.style.display = 'none';
      commentBox.style.visibility = 'hidden';
      if (clear !== false) commentInput.value = '';
    }

    function positionCommentBox(el) {
      if (!el) return;
      commentBox.style.display = 'block';
      commentBox.style.visibility = 'hidden';
      commentBox.style.left = '8px';
      commentBox.style.top = '8px';

      var rect = el.getBoundingClientRect();
      var width = commentBox.offsetWidth || 320;
      var height = commentBox.offsetHeight || 170;
      var left = rect.right + 12;
      if (left + width > window.innerWidth - 8) left = rect.left - width - 12;
      if (left < 8) left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
      var top = rect.top;
      if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
      if (top < 8) top = 8;

      commentBox.style.left = left + 'px';
      commentBox.style.top = top + 'px';
      commentBox.style.visibility = 'visible';
    }

    function commentLabel(el) {
      var data = readInfo(el);
      var comp = data.component || (data.source && data.source.component);
      var label = 'Commenting on ' + (comp ? '<' + comp + '>' : '<' + data.tag + '>');
      if (!data.source || !data.source.file) return label;
      var file = stripPath(data.source.file).split('/').pop();
      return label + ' · ' + file + ':' + (data.source.line || 1);
    }

    function showCommentBox(el) {
      if (!el) return;
      commentMeta.textContent = commentLabel(el);
      positionCommentBox(el);
      requestAnimationFrame(function() {
        commentInput.focus();
      });
    }

    function submitComment() {
      if (!currentEl) return;
      var comment = commentInput.value.trim();
      if (!comment) return;
      var data = readInfo(currentEl);
      if (!data) return;
      post('comment-submit', { comment: comment, info: data });
      hideCommentBox();
    }

    commentInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        hideCommentBox();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitComment();
      }
    });

    commentCancel.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
    });
    commentCancel.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      hideCommentBox();
    });

    commentSubmit.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
    });
    commentSubmit.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      submitComment();
    });

    // "+" click → open inline comment editor in the preview itself
    commentBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!currentEl) return;
      showCommentBox(currentEl);
    });

    openBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!currentEl) return;
      var data = readInfo(currentEl, true);
      if (!data) return;
      post('open-selected', data);
    });

    document.addEventListener('mousemove', function(e) {
      hoverX = e.clientX;
      hoverY = e.clientY;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(applyHover);
    }, true);

    document.addEventListener('mouseleave', function() {
      hoverEl = null;
      overlay.style.display = 'none';
      label.style.display = 'none';
    }, true);

    // Hide hover overlay on scroll, reposition selected overlay immediately
    window.addEventListener('scroll', function() {
      hoverEl = null;
      overlay.style.display = 'none';
      label.style.display = 'none';
      queueSelection();
    }, true);

    // Reposition selected overlay + comment button on window resize
    window.addEventListener('resize', function() {
      queueSelection();
    });

    document.addEventListener('click', function(e) {
      if (!inspectMode) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isOverlay(el)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      post('element-select', selectElement(el));
    }, true);

    // Exposed for main webview to call via eval_design_webview
    window.__opencode_apply_styles = function(styles) {
      if (currentEl && styles) {
        Object.assign(currentEl.style, styles);
        currentInfo = info(currentEl);
        syncSelection();
      }
    };

    window.__opencode_select_element = function(selector) {
      var target = document.querySelector(selector);
      if (!target || isOverlay(target)) return;
      var data = selectElement(target);
      showLabel(target);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      post('element-select', data);
    };
  }

  function boot() {
    if (document.body) {
      init();
      // Re-dispatch events that animations/intersection observers may depend on
      try {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('load'));
      } catch(e) {}
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        init();
        try {
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('load'));
        } catch(e) {}
      });
    }
  }

  boot();
})();
`
}
