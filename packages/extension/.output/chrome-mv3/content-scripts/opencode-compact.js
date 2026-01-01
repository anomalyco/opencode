var opencodeCompact=(function(){"use strict";function C(t){return t}const f={matches:["http://localhost:4096/*","http://127.0.0.1:4096/*"],runAt:"document_start",allFrames:!0,main(){new URLSearchParams(window.location.search).get("eidorail")==="compact"&&(console.log("[Eidorail] OpenCode compact mode activated"),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{u(),h()}):(u(),h()))}};function u(){const t=document.createElement("style");t.id="eidorail-compact-styles",t.textContent=`
    /* ===========================================
       Eidorail Compact Mode for OpenCode Desktop
       Applied when embedded in browser extension
       =========================================== */

    /* ---- CORE: Left sidebar as toggleable overlay ---- */
    /* Sidebar hidden by default, shown as overlay when toggled */
    body.eidorail-compact > div > div > aside,
    body.eidorail-compact [data-sidebar],
    body.eidorail-compact .w-12.border-r,
    body.eidorail-compact > div > div > div:first-child[class*="border-r"] {
      display: none !important;
    }

    /* Mobile sidebar (w-72) - position as overlay when open */
    body.eidorail-compact .fixed.inset-y-0.left-0.z-50 {
      transform: translateX(-100%);
      transition: transform 0.2s ease;
    }

    body.eidorail-compact.sidebar-open .fixed.inset-y-0.left-0.z-50 {
      transform: translateX(0) !important;
      display: flex !important;
    }

    /* Backdrop when sidebar is open */
    body.eidorail-compact.sidebar-open::after {
      content: "";
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 49;
      pointer-events: auto;
    }

    /* ---- HEADER: Optimize for narrow width ---- */
    body.eidorail-compact header {
      padding-left: 12px !important;
      padding-right: 12px !important;
      gap: 8px !important;
    }

    /* De-emphasize the orange Home/Mark link - make it subtle */
    body.eidorail-compact header a[href="/"] svg,
    body.eidorail-compact header a:first-child svg {
      width: 20px !important;
      height: 20px !important;
      opacity: 0.7;
    }

    body.eidorail-compact header a[href="/"]:hover svg,
    body.eidorail-compact header a:first-child:hover svg {
      opacity: 1;
    }

    /* Project/session selectors - compact them */
    body.eidorail-compact header button[class*="text-14"] {
      padding: 4px 8px !important;
      font-size: 13px !important;
    }

    /* Hide unnecessary header elements on very narrow widths */
    @media (max-width: 350px) {
      body.eidorail-compact header > a:first-child {
        display: none !important;
      }
    }

    /* ---- MAIN CONTENT: Full width ---- */
    body.eidorail-compact main {
      width: 100% !important;
      max-width: 100% !important;
      margin-left: 0 !important;
    }

    /* ---- HOME PAGE: Improve empty state ---- */
    /* Recent projects list - better hover states */
    body.eidorail-compact [class*="group/item"] {
      border-radius: 8px !important;
      transition: background-color 0.15s ease !important;
    }

    body.eidorail-compact [class*="group/item"]:hover {
      background-color: var(--color-background-surface, rgba(255,255,255,0.05)) !important;
    }

    /* Project items - add visual affordance */
    body.eidorail-compact [class*="group/item"]::before {
      content: "";
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 0;
      background: var(--color-text-brand, #f97316);
      border-radius: 0 2px 2px 0;
      transition: height 0.15s ease;
    }

    body.eidorail-compact [class*="group/item"]:hover::before {
      height: 60%;
    }

    /* ---- CHAT/SESSION: Optimize message display ---- */
    body.eidorail-compact [class*="message"],
    body.eidorail-compact [class*="Message"] {
      padding-left: 12px !important;
      padding-right: 12px !important;
    }

    /* Input area - ensure it's prominent */
    body.eidorail-compact textarea {
      font-size: 14px !important;
      min-height: 60px !important;
    }

    /* ---- ACCESSIBILITY: Larger touch targets ---- */
    body.eidorail-compact button {
      min-height: 36px !important;
      min-width: 36px !important;
    }

    body.eidorail-compact a[href] {
      min-height: 32px !important;
    }

    /* ---- EMPTY STATE OVERLAY ---- */
    /* Shows helpful guidance when no session is active */
    .eidorail-welcome-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      background: var(--color-background-base, #0a0a0a);
      z-index: 100;
      opacity: 1;
      transition: opacity 0.3s ease;
      pointer-events: auto;
    }

    .eidorail-welcome-overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .eidorail-welcome-overlay h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text-strong, #fff);
      margin: 0 0 8px 0;
    }

    .eidorail-welcome-overlay p {
      font-size: 14px;
      color: var(--color-text-dimmed, #888);
      margin: 0 0 20px 0;
      max-width: 280px;
      line-height: 1.5;
    }

    .eidorail-welcome-overlay .quick-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 240px;
    }

    .eidorail-welcome-overlay button {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid var(--color-border-base, #333);
      background: var(--color-background-surface, #1a1a1a);
      color: var(--color-text-base, #fff);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .eidorail-welcome-overlay button:hover {
      background: var(--color-background-hover, #252525);
      border-color: var(--color-border-strong, #444);
    }

    .eidorail-welcome-overlay button.primary {
      background: var(--color-text-brand, #f97316);
      border-color: transparent;
      color: #fff;
    }

    .eidorail-welcome-overlay button.primary:hover {
      background: #ea580c;
    }

    .eidorail-welcome-overlay .keyboard-hint {
      margin-top: 16px;
      font-size: 12px;
      color: var(--color-text-dimmed, #666);
    }

    .eidorail-welcome-overlay kbd {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--color-background-surface, #1a1a1a);
      border: 1px solid var(--color-border-base, #333);
      font-family: inherit;
      font-size: 11px;
    }

    /* ---- FLOATING MENU BUTTON ---- */
    /* Quick access to sidebar functions without the rail */
    .eidorail-menu-button {
      position: fixed;
      bottom: 12px;
      left: 12px;
      z-index: 1001;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--color-background-surface, #1a1a1a);
      border: 1px solid var(--color-border-base, #333);
      color: var(--color-text-base, #fff);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .eidorail-menu-button:hover {
      background: var(--color-background-hover, #252525);
      transform: scale(1.05);
    }

    .eidorail-menu-button svg {
      width: 18px;
      height: 18px;
    }



    /* ---- RESPONSIVE ADJUSTMENTS ---- */
    @media (max-width: 400px) {
      body.eidorail-compact header {
        padding-left: 8px !important;
        padding-right: 8px !important;
        height: 44px !important;
      }

      body.eidorail-compact header button span:not(:first-child) {
        display: none !important;
      }

      .eidorail-welcome-overlay {
        padding: 16px;
      }

      .eidorail-welcome-overlay h2 {
        font-size: 16px;
      }
    }

    /* ---- INPUT AREA: Dock to bottom ---- */
    body.eidorail-compact .absolute.inset-x-0.bottom-4 {
      bottom: 0 !important;
      padding-left: 8px !important;
      padding-right: 8px !important;
      padding-bottom: 8px !important;
      background: var(--color-background-base, #0a0a0a) !important;
      border-top: 1px solid var(--color-border-weak-base, #333);
    }

    body.eidorail-compact [contenteditable="true"] {
      padding-left: 12px !important;
    }

    /* ---- HEADER: Compact padding ---- */
    body.eidorail-compact header > div {
      padding-left: 48px !important;
      padding-right: 12px !important;
    }

    /* ---- MENU BUTTON: Top-left position ---- */
    .eidorail-menu-button {
      bottom: auto !important;
      right: auto !important;
      top: 5px !important;
      left: 6px !important;
      width: 34px !important;
      height: 34px !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    .eidorail-menu-button:hover {
      background: var(--color-background-surface, #1a1a1a) !important;
      border: 1px solid var(--color-border-base, #333) !important;
    }



    /* ---- SIDEBAR: Overlay mode ---- */
    body.eidorail-compact .fixed.inset-y-0.left-0.w-72,
    body.eidorail-compact .xl\\:hidden > .fixed.inset-y-0.left-0,
    body.eidorail-compact [class*="fixed"][class*="inset-y-0"][class*="left-0"][class*="w-"] {
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      z-index: 50 !important;
    }

    body.eidorail-compact .eidorail-sidebar-visible,
    body.eidorail-compact.sidebar-open .fixed.inset-y-0.left-0.w-72,
    body.eidorail-compact.sidebar-open .xl\\:hidden > .fixed.inset-y-0.left-0 {
      transform: translateX(0) !important;
      display: flex !important;
    }

    /* ---- MOBILE LAYOUT: No bottom gap ---- */
    body.eidorail-compact .md\\:hidden.flex-1 {
      padding-bottom: 0 !important;
    }

    /* ---- SCROLLBAR: Subtle styling ---- */
    body.eidorail-compact ::-webkit-scrollbar {
      width: 6px;
    }

    body.eidorail-compact ::-webkit-scrollbar-track {
      background: transparent;
    }

    body.eidorail-compact ::-webkit-scrollbar-thumb {
      background: var(--color-border-base, #333);
      border-radius: 3px;
    }

    body.eidorail-compact ::-webkit-scrollbar-thumb:hover {
      background: var(--color-border-strong, #444);
    }

    /* ---- HOME PAGE: Reduce vertical spacing ---- */
    body.eidorail-compact main > div.mt-55,
    body.eidorail-compact main > div[class*="mt-55"] {
      margin-top: 24px !important;
      width: 100% !important;
      max-width: 100% !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }

    body.eidorail-compact main > div.mt-55 > svg,
    body.eidorail-compact main > div[class*="mt-55"] > svg {
      max-width: 180px !important;
      height: auto !important;
    }

    body.eidorail-compact main div.mt-20 {
      margin-top: 16px !important;
    }

    body.eidorail-compact main div.mt-30 {
      margin-top: 24px !important;
    }

    body.eidorail-compact main [class~="mt-20"][class~="w-full"][class~="flex"][class~="flex-col"][class~="gap-4"]
      > [class~="flex"][class~="gap-2"][class~="items-center"][class~="justify-between"][class~="pl-3"] {
      flex-wrap: wrap !important;
      gap: 8px !important;
      align-items: flex-start;
    }

    body.eidorail-compact main [class~="mt-20"][class~="w-full"][class~="flex"][class~="flex-col"][class~="gap-4"]
      > [class~="flex"][class~="gap-2"][class~="items-center"][class~="justify-between"][class~="pl-3"]
      > button[class~="pl-2"][class~="pr-3"] {
      width: 100% !important;
    }

    /* Ensure home page content fits without scrolling at narrow widths */
    @media (max-height: 600px) {
      body.eidorail-compact main > div.mt-55,
      body.eidorail-compact main > div[class*="mt-55"] {
        margin-top: 12px !important;
      }
      
      body.eidorail-compact main > div.mt-55 > svg,
      body.eidorail-compact main > div[class*="mt-55"] > svg {
        max-width: 120px !important;
      }
      
      body.eidorail-compact main div.mt-20,
      body.eidorail-compact main div.mt-30 {
        margin-top: 12px !important;
      }
    }
    
    /* Extra compact for very narrow viewports */
    @media (max-width: 350px) {
      body.eidorail-compact main > div.mt-55,
      body.eidorail-compact main > div[class*="mt-55"] {
        margin-top: 16px !important;
      }
      
      body.eidorail-compact main > div.mt-55 > svg,
      body.eidorail-compact main > div[class*="mt-55"] > svg {
        max-width: 140px !important;
      }
    }
  `,document.head?document.head.appendChild(t):document.documentElement.appendChild(t)}function h(){document.body.classList.add("eidorail-compact"),v(),y(),w(),S(),k()}function v(){try{const t="default-layout.v7",e=localStorage.getItem(t);if(e){const o=JSON.parse(e);o.sidebar&&o.sidebar.opened&&(o.sidebar.opened=!1,localStorage.setItem(t,JSON.stringify(o)),console.log("[Eidorail] Ensured sidebar is closed"))}}catch(t){console.warn("[Eidorail] Could not modify sidebar state:",t)}}function y(){if(document.querySelector(".eidorail-menu-button"))return;const t=document.createElement("button");t.className="eidorail-menu-button",t.title="Toggle sidebar",t.innerHTML=`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 12h18M3 6h18M3 18h18"/>
    </svg>
  `,t.addEventListener("click",e=>{e.stopPropagation(),x()}),document.body.appendChild(t)}function l(){const t=[".fixed.inset-y-0.left-0.w-72",".fixed.inset-y-0.left-0.z-50",'[class*="fixed"][class*="inset-y-0"][class*="left-0"][class*="w-"]',"aside.fixed",'[data-sidebar="true"]'];for(const e of t){const o=document.querySelector(e);if(o&&o.offsetWidth>50)return o}return null}function x(){const t=l();if(!t){console.warn("[Eidorail] Sidebar element not found");return}const e=document.body.classList.toggle("sidebar-open");t.classList.toggle("eidorail-sidebar-visible",e),p(e)}function p(t){try{const e="default-layout.v7",o=localStorage.getItem(e),a=o?JSON.parse(o):{};a.sidebar=a.sidebar||{},a.sidebar.opened=t,localStorage.setItem(e,JSON.stringify(a)),window.dispatchEvent(new StorageEvent("storage",{key:e}))}catch(e){console.warn("[Eidorail] Could not update sidebar state:",e)}}function w(){document.addEventListener("click",t=>{if(!document.body.classList.contains("sidebar-open"))return;const e=t.target,o=l(),a=document.querySelector(".eidorail-menu-button");o?.contains(e)||a?.contains(e)||(o?.classList.remove("eidorail-sidebar-visible"),document.body.classList.remove("sidebar-open"),p(!1))})}function S(){const t=window.location.pathname==="/"||window.location.pathname==="",e=window.location.pathname.includes("/session/");t&&!e&&(document.querySelector('[class*="group/item"]')||E())}function E(){if(document.querySelector(".eidorail-welcome-overlay"))return;const t=document.createElement("div");t.className="eidorail-welcome-overlay",t.innerHTML=`
    <h2>Welcome to OpenCode</h2>
    <p>Your AI coding assistant, right in your browser sidebar.</p>
    <div class="quick-actions">
      <button class="primary" data-action="start-chat">
        Start a new chat
      </button>
      <button data-action="open-project">
        Open a project folder
      </button>
    </div>
    <div class="keyboard-hint">
      Press <kbd>⌘</kbd> + <kbd>K</kbd> to open command palette
    </div>
  `,t.addEventListener("click",o=>{const i=o.target.closest("button[data-action]");if(!i)return;const c=i.dataset.action;if(t.classList.add("hidden"),setTimeout(()=>t.remove(),300),c==="start-chat"){const r=document.querySelector("textarea");r&&r.focus()}else if(c==="open-project"){const r=document.querySelector('button:has(svg[class*="folder"])');r&&r.click()}}),document.body.appendChild(t);const e=()=>{t.classList.add("hidden"),setTimeout(()=>t.remove(),300),document.removeEventListener("keydown",e)};document.addEventListener("keydown",e)}function k(){let t=window.location.pathname;const e=()=>{if(window.location.pathname!==t){t=window.location.pathname;const a=document.querySelector(".eidorail-welcome-overlay");a&&window.location.pathname.includes("/session/")&&a.classList.add("hidden")}};new MutationObserver(e).observe(document.body,{childList:!0,subtree:!0}),setInterval(e,500),document.addEventListener("keydown",a=>{a.key==="Escape"&&document.body.classList.contains("sidebar-open")&&(l()?.classList.remove("eidorail-sidebar-visible"),document.body.classList.remove("sidebar-open"),p(!1))})}const g=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome;function n(t,...e){}const I={debug:(...t)=>n(console.debug,...t),log:(...t)=>n(console.log,...t),warn:(...t)=>n(console.warn,...t),error:(...t)=>n(console.error,...t)};class m extends Event{constructor(e,o){super(m.EVENT_NAME,{}),this.newUrl=e,this.oldUrl=o}static EVENT_NAME=b("wxt:locationchange")}function b(t){return`${g?.runtime?.id}:opencode-compact:${t}`}function T(t){let e,o;return{run(){e==null&&(o=new URL(location.href),e=t.setInterval(()=>{let a=new URL(location.href);a.href!==o.href&&(window.dispatchEvent(new m(a,o)),o=a)},1e3))}}}class s{constructor(e,o){this.contentScriptName=e,this.options=o,this.abortController=new AbortController,this.isTopFrame?(this.listenForNewerScripts({ignoreFirstEvent:!0}),this.stopOldScripts()):this.listenForNewerScripts()}static SCRIPT_STARTED_MESSAGE_TYPE=b("wxt:content-script-started");isTopFrame=window.self===window.top;abortController;locationWatcher=T(this);receivedMessageIds=new Set;get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return g.runtime.id==null&&this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener("abort",e),()=>this.signal.removeEventListener("abort",e)}block(){return new Promise(()=>{})}setInterval(e,o){const a=setInterval(()=>{this.isValid&&e()},o);return this.onInvalidated(()=>clearInterval(a)),a}setTimeout(e,o){const a=setTimeout(()=>{this.isValid&&e()},o);return this.onInvalidated(()=>clearTimeout(a)),a}requestAnimationFrame(e){const o=requestAnimationFrame((...a)=>{this.isValid&&e(...a)});return this.onInvalidated(()=>cancelAnimationFrame(o)),o}requestIdleCallback(e,o){const a=requestIdleCallback((...i)=>{this.signal.aborted||e(...i)},o);return this.onInvalidated(()=>cancelIdleCallback(a)),a}addEventListener(e,o,a,i){o==="wxt:locationchange"&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(o.startsWith("wxt:")?b(o):o,a,{...i,signal:this.signal})}notifyInvalidated(){this.abort("Content script context invalidated"),I.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){window.postMessage({type:s.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:Math.random().toString(36).slice(2)},"*")}verifyScriptStartedEvent(e){const o=e.data?.type===s.SCRIPT_STARTED_MESSAGE_TYPE,a=e.data?.contentScriptName===this.contentScriptName,i=!this.receivedMessageIds.has(e.data?.messageId);return o&&a&&i}listenForNewerScripts(e){let o=!0;const a=i=>{if(this.verifyScriptStartedEvent(i)){this.receivedMessageIds.add(i.data.messageId);const c=o;if(o=!1,c&&e?.ignoreFirstEvent)return;this.notifyInvalidated()}};addEventListener("message",a),this.onInvalidated(()=>removeEventListener("message",a))}}function M(){}function d(t,...e){}const L={debug:(...t)=>d(console.debug,...t),log:(...t)=>d(console.log,...t),warn:(...t)=>d(console.warn,...t),error:(...t)=>d(console.error,...t)};return(async()=>{try{const{main:t,...e}=f,o=new s("opencode-compact",e);return await t(o)}catch(t){throw L.error('The content script "opencode-compact" crashed on startup!',t),t}})()})();
opencodeCompact;