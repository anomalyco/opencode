var claudeIframeFix=(function(){"use strict";function i(e){return e}const o={matches:["https://claude.ai/*"],runAt:"document_start",world:"MAIN",main(){try{Object.defineProperty(window,"self",{get:()=>window.top,configurable:!0}),Object.defineProperty(window,"frameElement",{get:()=>null,configurable:!0}),Object.defineProperty(window,"parent",{get:()=>window,configurable:!0}),console.log("[Eidorail] Claude.ai iframe detection overridden")}catch(n){console.warn("[Eidorail] Could not override iframe detection:",n)}const e=document.createElement("style");e.textContent=`
      /* Force sidebar toggle button to be visible */
      button[data-testid="sidebar-toggle"] svg,
      button svg.opacity-0,
      [aria-label*="sidebar" i] svg.opacity-0,
      [aria-label*="menu" i] svg.opacity-0 {
        opacity: 1 !important;
        transform: scale(1) !important;
      }
      
      /* Ensure the button container is visible too */
      button:has(svg.opacity-0) {
        opacity: 1 !important;
        visibility: visible !important;
      }
    `,document.head?document.head.appendChild(e):document.addEventListener("DOMContentLoaded",()=>{document.head.appendChild(e)})}};function a(){}function t(e,...n){}const r={debug:(...e)=>t(console.debug,...e),log:(...e)=>t(console.log,...e),warn:(...e)=>t(console.warn,...e),error:(...e)=>t(console.error,...e)};return(async()=>{try{return await o.main()}catch(e){throw r.error('The content script "claude-iframe-fix" crashed on startup!',e),e}})()})();
claudeIframeFix;