var conversationExport=(function(){"use strict";function W(e){return e}function P(e){console.log("[Eidorail Export] Extracting Claude conversation...");let t="Untitled Conversation";const o=['[data-testid="conversation-title"]','button[data-testid="chat-menu-trigger"]',"h1",'[class*="ConversationTitle"]',"header h1"];for(const i of o){const a=document.querySelector(i)?.textContent?.trim();if(a&&a.length>0&&a.length<200){t=a;break}}const n=[];let s=0;const r=document.querySelectorAll('[data-testid^="chat-message"]');if(r.length>0)for(const i of r){const l=i.getAttribute("data-testid")||"",a=l.includes("human")||l.includes("user"),c=i.cloneNode(!0);c.querySelectorAll('[class*="thinking"], [class*="Thinking"], button, svg').forEach(d=>d.remove());const m=c.textContent?.trim()||"";m&&n.push({id:`msg-claude-${s++}`,role:a?"user":"assistant",content:m,timestamp:new Date().toISOString()})}if(n.length===0){const i=document.querySelectorAll(".font-user-message, .font-claude-message, [class*='human-turn'], [class*='assistant-turn']"),l=new Set;for(const a of i){if(l.has(a)||Array.from(l).some(p=>p.contains(a)||a.contains(p)))continue;l.add(a);const c=a.className||"",m=c.includes("font-user")||c.includes("human")||a.closest('[class*="human"]')!==null,d=a.cloneNode(!0);d.querySelectorAll('[class*="thinking"], button, svg').forEach(p=>p.remove());const u=d.textContent?.trim()||"";u&&n.push({id:`msg-claude-${s++}`,role:m?"user":"assistant",content:u,timestamp:new Date().toISOString()})}}return console.log("[Eidorail Export] Extracted",n.length,"Claude messages"),{id:e,title:t,messages:n,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),source:"claude.ai"}}async function L(e){try{const t=await fetch(`https://chatgpt.com/backend-api/conversation/${e}`,{credentials:"include"});if(!t.ok)return null;const o=await t.json(),n=[],s=o.mapping||{},r=Object.keys(s),i=new Map;for(const u of r){const p=s[u];p.parent&&i.set(u,p.parent)}const l=[],a=new Set;let c=o.current_node;const m=[];for(;c&&!a.has(c);)a.add(c),m.unshift(c),c=i.get(c);let d=0;for(const u of m){const p=s[u];if(!p?.message)continue;const x=p.message,y=x.author?.role;if(y!=="user"&&y!=="assistant")continue;const U=(x.content?.parts||[]).filter(J=>typeof J=="string").join(`
`).trim();U&&n.push({id:`msg-chatgpt-${d++}`,role:y,content:U,timestamp:x.create_time?new Date(x.create_time*1e3).toISOString():new Date().toISOString()})}return{id:e,title:o.title||"Untitled Conversation",messages:n,created_at:o.create_time?new Date(o.create_time*1e3).toISOString():new Date().toISOString(),updated_at:o.update_time?new Date(o.update_time*1e3).toISOString():new Date().toISOString(),source:"chatgpt.com"}}catch(t){return console.error("[Eidorail Export] API fetch failed:",t),null}}function A(e){console.log("[Eidorail Export] Extracting ChatGPT from DOM...");let t=document.title.replace(" - ChatGPT","").replace("ChatGPT","").trim()||"Untitled Conversation";const o=document.querySelector('h1, [data-testid*="title"]');o?.textContent?.trim()&&(t=o.textContent.trim());const n=[],s=document.querySelectorAll("article[data-testid]");let r=0;for(const i of s){const l=i.getAttribute("data-testid")||"",a=i.querySelector("h5, h6")?.textContent?.toLowerCase()||"",c=l.includes("user")||a.includes("you said")||a.includes("you"),m=i.querySelector('[data-message-content="true"], .markdown, .prose, [class*="markdown"], [class*="prose"]');let d="";if(m){const u=m.cloneNode(!0);u.querySelectorAll("button, svg, [role='button']").forEach(p=>p.remove()),d=u.textContent?.trim()||""}else{const u=i.cloneNode(!0);u.querySelectorAll("h5, h6, button, svg").forEach(p=>p.remove()),d=u.textContent?.trim()||""}d&&n.push({id:`msg-chatgpt-${r++}`,role:c?"user":"assistant",content:d,timestamp:new Date().toISOString()})}if(n.length===0){const i=document.querySelectorAll("article");for(const l of i){const c=(l.querySelector("h5, h6")?.textContent?.toLowerCase()||"").includes("you"),m=l.cloneNode(!0);m.querySelectorAll("h5, h6, button, svg").forEach(u=>u.remove());const d=m.textContent?.trim()||"";d&&n.push({id:`msg-chatgpt-${r++}`,role:c?"user":"assistant",content:d,timestamp:new Date().toISOString()})}}return console.log("[Eidorail Export] Extracted",n.length,"ChatGPT messages from DOM"),{id:e,title:t,messages:n,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),source:"chatgpt.com"}}async function M(e){console.log("[Eidorail Export] Extracting ChatGPT conversation...");const t=await L(e);return t&&t.messages.length>0?(console.log("[Eidorail Export] Got",t.messages.length,"messages from API"),t):A(e)}function O(e){console.log("[Eidorail Export] Extracting Gemini conversation...");let t="Untitled Conversation";const o=['div[data-test-id="conversation"].selected .conversation-title',"h1",'[class*="conversation-title"]'];for(const i of o){const l=document.querySelector(i);if(l?.textContent?.trim()){t=l.textContent.trim();break}}t=t.replace(/^Gemini\s*-\s*/i,"").trim()||"Untitled Conversation";const n=[],s=document.querySelectorAll("user-query, model-response");let r=0;for(const i of s){const a=i.tagName.toLowerCase()==="user-query",c=a?"div.query-content":"message-content",d=i.querySelector(c)?.textContent?.trim()||"";d&&n.push({id:`msg-gemini-${r++}`,role:a?"user":"assistant",content:d,timestamp:new Date().toISOString()})}return console.log("[Eidorail Export] Extracted",n.length,"Gemini messages"),{id:e,title:t,messages:n,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),source:"gemini.google.com"}}async function S(e,t){switch(e){case"claude":return P(t);case"chatgpt":return await M(t);case"gemini":return O(t);default:throw new Error(`Unsupported platform for export: ${e}`)}}function D(e){return new Promise(t=>{const o=[];switch(e){case"claude":o.push('[data-testid^="chat-message"]',".font-user-message",".font-claude-message",'[class*="human-turn"]','[class*="assistant-turn"]');break;case"chatgpt":o.push("article[data-testid]","article","[data-message-author-role]",'[class*="markdown"]');break;case"gemini":o.push("user-query","model-response","message-content");break;default:t();return}const n=()=>{for(const r of o)if(document.querySelector(r))return!0;return!1};if(n()){setTimeout(t,500);return}const s=new MutationObserver(()=>{n()&&(s.disconnect(),setTimeout(t,500))});s.observe(document.body,{childList:!0,subtree:!0}),setTimeout(()=>{s.disconnect(),t()},15e3)})}function C(e){return e.replace(/[^a-z0-9\s-]/gi,"_").replace(/\s+/g,"_").substring(0,100)}function I(e){const t=e.getFullYear(),o=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),s=String(e.getHours()).padStart(2,"0"),r=String(e.getMinutes()).padStart(2,"0"),i=String(e.getSeconds()).padStart(2,"0");return`${t}-${o}-${n}_${s}-${r}-${i}`}function _(e,t){const o=t&&t.size>0?e.messages.filter(c=>t.has(c.id)):e.messages,n=`---
title: ${e.title}
date: ${e.created_at}
updated: ${e.updated_at}
source: ${e.source||"unknown"}
exporter: eidorail-v1.0
message_count: ${o.length}
conversation_id: ${e.id}
${e.project_uuid?`project_id: ${e.project_uuid}`:""}
---

`;let s=`# ${e.title}

`,r=0;for(const c of o)c.role==="user"?(r++,s+=`## ${r}. User

${c.content}

`):(s+=`### Assistant

${c.content}

`,s+=`---

`);const i=n+s,l=I(new Date),a=`${C(e.title)}_${l}.md`;return{content:i,filename:a,mimeType:"text/markdown"}}function N(e,t){const o=t&&t.size>0?e.messages.filter(l=>t.has(l.id)):e.messages,n={...e,messages:o,exporter:"eidorail-v1.0",exported_at:new Date().toISOString()},s=JSON.stringify(n,null,2),r=I(new Date),i=`${C(e.title)}_${r}.json`;return{content:s,filename:i,mimeType:"application/json"}}function F(e,t,o){const n=new Blob([t],{type:o}),s=URL.createObjectURL(n),r=document.createElement("a");r.href=s,r.download=e,r.style.display="none",document.body.appendChild(r),r.click(),setTimeout(()=>{document.body.removeChild(r),URL.revokeObjectURL(s)},100)}async function q(e){try{return await navigator.clipboard.writeText(e),!0}catch{const t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.opacity="0",document.body.appendChild(t),t.select();const o=document.execCommand("copy");return document.body.removeChild(t),o}}const w={opencode:{name:"OpenCode",hostnames:["localhost:4096"],conversationUrlPattern:null,exportEnabled:!1},claude:{name:"Claude",hostnames:["claude.ai"],conversationUrlPattern:/\/chat\/([^/?]+)/,exportEnabled:!0},chatgpt:{name:"ChatGPT",hostnames:["chat.openai.com","chatgpt.com"],conversationUrlPattern:/\/c\/([^/?]+)/,exportEnabled:!0},gemini:{name:"Gemini",hostnames:["gemini.google.com"],conversationUrlPattern:/\/app\/([^/?]+)/,exportEnabled:!0},perplexity:{name:"Perplexity",hostnames:["perplexity.ai"],conversationUrlPattern:/\/search\/([^/?]+)/,exportEnabled:!0},poe:{name:"Poe",hostnames:["poe.com"],conversationUrlPattern:/\/chat\/([^/?]+)/,exportEnabled:!0},you:{name:"You.com",hostnames:["you.com"],conversationUrlPattern:null,exportEnabled:!1},huggingface:{name:"HuggingFace",hostnames:["huggingface.co"],conversationUrlPattern:null,exportEnabled:!1},copilot:{name:"Copilot",hostnames:["copilot.microsoft.com"],conversationUrlPattern:null,exportEnabled:!1},deepseek:{name:"DeepSeek",hostnames:["chat.deepseek.com"],conversationUrlPattern:/\/chat\/([^/?]+)/,exportEnabled:!0},openrouter:{name:"OpenRouter",hostnames:["openrouter.ai"],conversationUrlPattern:null,exportEnabled:!1}};function B(e){const t=typeof window<"u"?window.location.hostname:null;if(!t)return null;for(const[o,n]of Object.entries(w))if(n.hostnames.some(s=>t.includes(s)))return o;return null}function k(e,t){const o=typeof window<"u"?window.location.pathname:null;if(!o)return null;const n=w[e];if(!n.conversationUrlPattern)return null;const s=o.match(n.conversationUrlPattern);return s?s[1]:null}function j(e){return w[e]?.exportEnabled??!1}const G={matches:["https://claude.ai/*","https://chat.openai.com/*","https://chatgpt.com/*","https://gemini.google.com/*"],async main(){console.log("[Eidorail Export] Content script loaded");const e=B();if(!e){console.log("[Eidorail Export] Unknown platform, skipping");return}if(console.log("[Eidorail Export] Detected platform:",e),!j(e)){console.log("[Eidorail Export] Export not supported for platform:",e);return}v(e);let t=location.href;new MutationObserver(()=>{location.href!==t&&(t=location.href,console.log("[Eidorail Export] URL changed:",t),T(),v(e))}).observe(document.body,{childList:!0,subtree:!0}),window.addEventListener("popstate",()=>{console.log("[Eidorail Export] Popstate event"),T(),v(e)})}};function v(e){const t=k(e);if(!t){console.log("[Eidorail Export] Not a conversation page, skipping");return}console.log("[Eidorail Export] Conversation ID:",t),D(e).then(()=>{console.log("[Eidorail Export] Conversation loaded, injecting UI"),R(e,t)})}function T(){const e=document.getElementById("eidorail-export-root");e&&e.remove()}function R(e,t){if(document.getElementById("eidorail-export-root"))return;const o=document.createElement("div");o.id="eidorail-export-root",document.body.appendChild(o);const n=o.attachShadow({mode:"open"});new z(n,e,t).render()}class z{shadow;platform;conversationId;conversation=null;selectedMessageIds=new Set;constructor(t,o,n){this.shadow=t,this.platform=o,this.conversationId=n}render(){const t=this.getStyles(),o=this.getHTML();this.shadow.innerHTML=`
      <style>${t}</style>
      ${o}
    `,this.attachEventListeners(),this.loadConversation()}getStyles(){return`
      :host {
        all: initial;
      }
      
      .export-container {
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 9999;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 14px;
      }
      
      .export-icon-button {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        color: #374151;
      }
      
      .export-icon-button:hover {
        background: #f9fafb;
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      
      .export-icon-button.menu-open {
        background: #f3f4f6;
      }
      
      .dropdown-menu {
        position: absolute;
        top: 52px;
        right: 0;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        min-width: 200px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px) scale(0.95);
        transform-origin: top right;
        transition: all 0.15s ease;
        overflow: hidden;
      }
      
      .dropdown-menu.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }
      
      .menu-section {
        padding: 6px 0;
      }
      
      .menu-section:not(:last-child) {
        border-bottom: 1px solid #e5e7eb;
      }
      
      .menu-section-label {
        padding: 6px 14px;
        font-size: 11px;
        font-weight: 600;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        transition: background 0.15s ease;
        color: #374151;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        font-size: 14px;
        font-family: inherit;
      }
      
      .menu-item:hover {
        background: #f3f4f6;
      }
      
      .menu-item:active {
        background: #e5e7eb;
      }
      
      .menu-item svg {
        flex-shrink: 0;
        color: #6b7280;
      }
      
      .menu-item span {
        flex: 1;
      }
      
      .menu-item.success {
        color: #059669;
      }
      
      .menu-item.success svg {
        color: #059669;
      }
      
      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1f2937;
        color: #ffffff;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(8px);
        transition: all 0.2s ease;
        z-index: 10000;
      }
      
      .toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      
      .toast.success {
        background: #059669;
      }
      
      .toast.error {
        background: #dc2626;
      }
      
      @media (prefers-color-scheme: dark) {
        .export-icon-button {
          background: #374151;
          border-color: #4b5563;
          color: #e5e7eb;
        }
        
        .export-icon-button:hover {
          background: #4b5563;
        }
        
        .export-icon-button.menu-open {
          background: #4b5563;
        }
        
        .dropdown-menu {
          background: #1f2937;
          border-color: #374151;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        
        .menu-section:not(:last-child) {
          border-color: #374151;
        }
        
        .menu-section-label {
          color: #6b7280;
        }
        
        .menu-item {
          color: #e5e7eb;
        }
        
        .menu-item:hover {
          background: #374151;
        }
        
        .menu-item:active {
          background: #4b5563;
        }
        
        .menu-item svg {
          color: #9ca3af;
        }
        
        .menu-item.success {
          color: #34d399;
        }
        
        .menu-item.success svg {
          color: #34d399;
        }
        
        .toast {
          background: #374151;
        }
      }
    `}getHTML(){return`
      <div class="export-container">
        <button class="export-icon-button" id="icon-btn" title="Export Conversation">
          <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
        
        <div class="dropdown-menu" id="dropdown">
          <div class="menu-section">
            <div class="menu-section-label">Copy</div>
            <button class="menu-item" id="copy-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy as Markdown</span>
            </button>
            <button class="menu-item" id="copy-json">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy as JSON</span>
            </button>
          </div>
          <div class="menu-section">
            <div class="menu-section-label">Download</div>
            <button class="menu-item" id="download-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download Markdown</span>
            </button>
            <button class="menu-item" id="download-json">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download JSON</span>
            </button>
          </div>
        </div>
        
        <div class="toast" id="toast"></div>
      </div>
    `}attachEventListeners(){const t=this.shadow.getElementById("icon-btn"),o=this.shadow.getElementById("dropdown");t?.addEventListener("click",n=>{n.stopPropagation(),o?.classList.contains("open")?this.closeMenu():this.openMenu()}),document.addEventListener("click",()=>{this.closeMenu()}),this.shadow.getElementById("copy-md")?.addEventListener("click",()=>{this.handleAction("copy","markdown")}),this.shadow.getElementById("copy-json")?.addEventListener("click",()=>{this.handleAction("copy","json")}),this.shadow.getElementById("download-md")?.addEventListener("click",()=>{this.handleAction("download","markdown")}),this.shadow.getElementById("download-json")?.addEventListener("click",()=>{this.handleAction("download","json")})}openMenu(){const t=this.shadow.getElementById("icon-btn"),o=this.shadow.getElementById("dropdown");t?.classList.add("menu-open"),o?.classList.add("open")}closeMenu(){const t=this.shadow.getElementById("icon-btn"),o=this.shadow.getElementById("dropdown");t?.classList.remove("menu-open"),o?.classList.remove("open")}showToast(t,o="success"){const n=this.shadow.getElementById("toast");n&&(n.textContent=t,n.className=`toast show ${o}`,setTimeout(()=>{n.classList.remove("show")},2e3))}async handleAction(t,o){this.closeMenu();try{const n=await this.extractFreshConversation();if(!n||n.messages.length===0){this.showToast("No messages found","error");return}const s=new Set(n.messages.map(i=>i.id)),r=o==="markdown"?_(n,s):N(n,s);t==="copy"?await q(r.content)?this.showToast(`Copied ${n.messages.length} messages as ${o==="markdown"?"Markdown":"JSON"}`):this.showToast("Failed to copy","error"):(F(r.filename,r.content,r.mimeType),this.showToast(`Downloaded ${r.filename}`))}catch(n){console.error("[Eidorail Export] Action failed:",n),this.showToast(`Failed to ${t}`,"error")}}async extractFreshConversation(){try{const t=k(this.platform)||this.conversationId,o=await S(this.platform,t);return console.log("[Eidorail Export] Fresh extraction:",o.messages.length,"messages"),o}catch(t){return console.error("[Eidorail Export] Extraction failed:",t),null}}async loadConversation(){try{if(this.conversation=await S(this.platform,this.conversationId),console.log("[Eidorail Export] Initial load:",this.conversation?.messages.length,"messages"),this.conversation)for(const t of this.conversation.messages)this.selectedMessageIds.add(t.id)}catch(t){console.error("[Eidorail Export] Failed to load conversation:",t)}}}const $=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome;function h(e,...t){}const H={debug:(...e)=>h(console.debug,...e),log:(...e)=>h(console.log,...e),warn:(...e)=>h(console.warn,...e),error:(...e)=>h(console.error,...e)};class b extends Event{constructor(t,o){super(b.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=o}static EVENT_NAME=E("wxt:locationchange")}function E(e){return`${$?.runtime?.id}:conversation-export:${e}`}function V(e){let t,o;return{run(){t==null&&(o=new URL(location.href),t=e.setInterval(()=>{let n=new URL(location.href);n.href!==o.href&&(window.dispatchEvent(new b(n,o)),o=n)},1e3))}}}class g{constructor(t,o){this.contentScriptName=t,this.options=o,this.abortController=new AbortController,this.isTopFrame?(this.listenForNewerScripts({ignoreFirstEvent:!0}),this.stopOldScripts()):this.listenForNewerScripts()}static SCRIPT_STARTED_MESSAGE_TYPE=E("wxt:content-script-started");isTopFrame=window.self===window.top;abortController;locationWatcher=V(this);receivedMessageIds=new Set;get signal(){return this.abortController.signal}abort(t){return this.abortController.abort(t)}get isInvalid(){return $.runtime.id==null&&this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(t){return this.signal.addEventListener("abort",t),()=>this.signal.removeEventListener("abort",t)}block(){return new Promise(()=>{})}setInterval(t,o){const n=setInterval(()=>{this.isValid&&t()},o);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(t,o){const n=setTimeout(()=>{this.isValid&&t()},o);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(t){const o=requestAnimationFrame((...n)=>{this.isValid&&t(...n)});return this.onInvalidated(()=>cancelAnimationFrame(o)),o}requestIdleCallback(t,o){const n=requestIdleCallback((...s)=>{this.signal.aborted||t(...s)},o);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(t,o,n,s){o==="wxt:locationchange"&&this.isValid&&this.locationWatcher.run(),t.addEventListener?.(o.startsWith("wxt:")?E(o):o,n,{...s,signal:this.signal})}notifyInvalidated(){this.abort("Content script context invalidated"),H.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){window.postMessage({type:g.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:Math.random().toString(36).slice(2)},"*")}verifyScriptStartedEvent(t){const o=t.data?.type===g.SCRIPT_STARTED_MESSAGE_TYPE,n=t.data?.contentScriptName===this.contentScriptName,s=!this.receivedMessageIds.has(t.data?.messageId);return o&&n&&s}listenForNewerScripts(t){let o=!0;const n=s=>{if(this.verifyScriptStartedEvent(s)){this.receivedMessageIds.add(s.data.messageId);const r=o;if(o=!1,r&&t?.ignoreFirstEvent)return;this.notifyInvalidated()}};addEventListener("message",n),this.onInvalidated(()=>removeEventListener("message",n))}}function Q(){}function f(e,...t){}const Y={debug:(...e)=>f(console.debug,...e),log:(...e)=>f(console.log,...e),warn:(...e)=>f(console.warn,...e),error:(...e)=>f(console.error,...e)};return(async()=>{try{const{main:e,...t}=G,o=new g("conversation-export",t);return await e(o)}catch(e){throw Y.error('The content script "conversation-export" crashed on startup!',e),e}})()})();
conversationExport;