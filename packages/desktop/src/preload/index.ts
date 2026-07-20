import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI, WslServersEvent } from "./types"
import type { UpdaterState } from "@opencode-ai/app/updater"

// BiDi text direction support + message metadata footer
{
const css = `[data-component="markdown"]>*{unicode-bidi:plaintext !important}[data-slot="text-part-body"]>*{unicode-bidi:plaintext !important}[data-slot="user-message-text"]{unicode-bidi:plaintext !important}[data-component="reasoning-part"]>*{unicode-bidi:plaintext !important}[data-component="tool-output"]{unicode-bidi:plaintext !important}[data-slot="question-text"]{unicode-bidi:plaintext !important}[data-slot="answer-text"]{unicode-bidi:plaintext !important}[data-component="markdown"] code,[data-component="markdown"] pre{direction:ltr;unicode-bidi:isolate !important}[data-component="markdown"] pre code{unicode-bidi:isolate !important}[data-component="prompt-input"]{unicode-bidi:plaintext !important}`
const s = document.createElement("style");s.textContent=css;s.id="oc-bidi-fix"
const inj=()=>{if(document.head){document.head.appendChild(s);return true}return false}
if(!inj())document.addEventListener("DOMContentLoaded",inj,{once:true})
const C='[data-component="markdown"],[data-slot="text-part-body"],[data-slot="user-message-text"],[data-component="reasoning-part"],[data-component="tool-output"],[data-slot="question-text"],[data-slot="answer-text"]'
const B='p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote'
const R='[data-slot="question-text"],[data-slot="answer-text"],[data-component="tool-output"],[data-slot="user-message-text"]'
const I='[data-component="prompt-input"],[contenteditable]'
const ir=c=>{const p=c.codePointAt(0);return(p>=0x0590&&p<=0x05FF)||(p>=0x0600&&p<=0x06FF)||(p>=0x0750&&p<=0x077F)||(p>=0x08A0&&p<=0x08FF)||(p>=0xFB1D&&p<=0xFDFF)||(p>=0xFE70&&p<=0xFEFF)};
const da=el=>{const t=el.textContent;let r=0,l=0,f=null;for(const c of t){if(ir(c)){r++;if(f===null)f='r'}else if(/[A-Za-z\u00C0-\u024F]/.test(c)){l++;if(f===null)f='l'}}if(f==='r'){el.setAttribute('dir','rtl');return}if(f==='l'&&r>0&&r>=l*0.4){el.setAttribute('dir','rtl');return}el.setAttribute('dir','ltr')};
const co=el=>{if(el.getAttribute("data-cd")==="1")return;el.setAttribute("data-cd","1");new MutationObserver(recs=>{for(const r of recs){if(r.type!=="characterData")continue;const p=r.target.parentElement;if(!p)continue;if(p.matches(B)&&p.closest(C))da(p);else if(p.matches(R))da(p)}}).observe(el,{childList:true,subtree:true,characterData:true})}
const mc=el=>{if(el.getAttribute("data-bc")!=="1"){el.setAttribute("data-bc","1");el.querySelectorAll(B).forEach(da);el.querySelectorAll(R).forEach(da);co(el)}}
const mo=new MutationObserver(recs=>{for(const r of recs){for(const n of r.addedNodes){if(n.nodeType!==1)continue;if(n.matches(C))mc(n);else n.querySelectorAll(C).forEach(mc);if(n.matches(I))da(n);else n.querySelectorAll(I).forEach(da);if(n.matches(B)&&n.closest(C))da(n);else n.querySelectorAll(B).forEach(el=>{if(el.closest(C))da(el)});if(n.matches(R))da(n);else n.querySelectorAll(R).forEach(el=>{if(el.closest(C)||el.matches(R))da(el)})}}})
if(document.documentElement)mo.observe(document.documentElement,{childList:true,subtree:true})
else document.addEventListener("DOMContentLoaded",()=>mo.observe(document.documentElement,{childList:true,subtree:true}),{once:true})
document.querySelectorAll(C).forEach(mc)
document.querySelectorAll(I).forEach(da)

const mc2=".oc-mf{font-size:11px;color:var(--text-weak);margin-top:4px;text-align:right;cursor:default;line-height:1.4}.oc-mf-ts,.oc-mf-tok{white-space:nowrap}"
const s2=document.createElement("style");s2.textContent=mc2;s2.id="oc-meta-fix"
const inj2=()=>{if(document.head){document.head.appendChild(s2);return true}return false}
if(!inj2())document.addEventListener("DOMContentLoaded",inj2,{once:true})
const fm=d=>{const n=new Date();const sd=d.toDateString()===n.toDateString();const yd=new Date(n);yd.setDate(yd.getDate()-1);const iy=d.toDateString()===yd.toDateString();const ts=d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});if(sd)return"Today, "+ts;if(iy)return"Yesterday, "+ts;if(d.getFullYear()===n.getFullYear())return d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+", "+ts;return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})+", "+ts}
const mf=el=>{if(el.getAttribute("data-mf")==="1")return;const ia=el.matches('[data-component="text-part"]');if(!el.matches('[data-component="user-message"]')&&!ia)return;const tc=el.getAttribute("data-time-created");const tcom=el.getAttribute("data-time-completed");if(ia&&tcom===null)return;el.setAttribute("data-mf","1");const f=document.createElement("div");f.className="oc-mf";const p=[];if(tc){const d=new Date(parseInt(tc,10));const sp=document.createElement("span");sp.className="oc-mf-ts";sp.textContent=fm(d);sp.title=d.toLocaleString();p.push(sp)}if(ia){const ti=el.getAttribute("data-tokens-input");const to=el.getAttribute("data-tokens-output");const tr=el.getAttribute("data-tokens-reasoning");if(to){p.push(document.createTextNode(" \u00B7 "));const sp=document.createElement("span");sp.className="oc-mf-tok";sp.textContent="\u2191"+(ti||"0")+" \u2193"+to;const tip=[];if(ti)tip.push("Input: "+(+ti).toLocaleString()+" tok");if(to)tip.push("Output: "+(+to).toLocaleString()+" tok");if(tr)tip.push("Thinking: "+(+tr).toLocaleString()+" tok");if(tc&&tcom){const ms=parseInt(tcom,10)-parseInt(tc,10);if(ms>0){const tps=((+to)/(ms/1e3)).toFixed(1);tip.push("Speed: ~"+tps+" tok/s");tip.push("Total: "+(ms/1e3).toFixed(1)+"s")}}sp.title=tip.join(" \u00B7 ");p.push(sp)}}if(p.length===0)return;p.forEach(x=>f.appendChild(x));const cw=el.querySelector('[data-slot="user-message-copy-wrapper"],[data-slot="text-part-copy-wrapper"]');if(cw&&cw.parentNode)cw.parentNode.insertBefore(f,cw.nextSibling);else el.appendChild(f)}
const m1=new MutationObserver(recs=>{for(const r of recs){for(const n of r.addedNodes){if(n.nodeType!==1)continue;if(n.matches('[data-component="user-message"],[data-component="text-part"]'))mf(n);else n.querySelectorAll('[data-component="user-message"],[data-component="text-part"]').forEach(mf)}}})
const m2=new MutationObserver(recs=>{for(const r of recs){if(r.type!=="attributes")continue;mf(r.target)}})
if(document.documentElement){m1.observe(document.documentElement,{childList:true,subtree:true});m2.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["data-time-completed"]})}else document.addEventListener("DOMContentLoaded",()=>{m1.observe(document.documentElement,{childList:true,subtree:true});m2.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["data-time-completed"]})},{once:true})
document.querySelectorAll('[data-component="user-message"],[data-component="text-part"]').forEach(mf)
}



const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
const updaterHandler = (_: unknown, state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: () => ipcRenderer.invoke("await-initialization"),
  wslServers: {
    getState: () => ipcRenderer.invoke("wsl-servers-get-state"),
    subscribe: (cb) => {
      const handler = (_: unknown, event: WslServersEvent) => cb(event)
      ipcRenderer.on("wsl-servers-event", handler)
      void ipcRenderer.invoke("wsl-servers-subscribe")
      return () => {
        ipcRenderer.removeListener("wsl-servers-event", handler)
        void ipcRenderer.invoke("wsl-servers-unsubscribe")
      }
    },
    probeRuntime: () => ipcRenderer.invoke("wsl-servers-probe-runtime"),
    refreshDistros: () => ipcRenderer.invoke("wsl-servers-refresh-distros"),
    installWsl: () => ipcRenderer.invoke("wsl-servers-install-wsl"),
    installDistro: (name) => ipcRenderer.invoke("wsl-servers-install-distro", name),
    probeAddable: (distros) => ipcRenderer.invoke("wsl-servers-probe-addable", distros),
    installOpencode: (name) => ipcRenderer.invoke("wsl-servers-install-opencode", name),
    openTerminal: (name) => ipcRenderer.invoke("wsl-servers-open-terminal", name),
    addServer: (distro) => ipcRenderer.invoke("wsl-servers-add", distro),
    removeServer: (id) => ipcRenderer.invoke("wsl-servers-remove", id),
    startServer: (id) => ipcRenderer.invoke("wsl-servers-start", id),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        ipcRenderer.on("updater-state", updaterHandler)
        updaterSubscription = ipcRenderer.invoke("updater-subscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        ipcRenderer.removeListener("updater-state", updaterHandler)
        updaterSubscription = undefined
        void ipcRenderer.invoke("updater-unsubscribe")
      }
    },
    check: () => ipcRenderer.invoke("updater-check"),
    install: () => ipcRenderer.invoke("updater-install"),
  },
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  isFirstLaunchOnboardingPending: () => ipcRenderer.invoke("is-first-launch-onboarding-pending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    ipcRenderer.invoke("finish-first-launch-onboarding", createDefaultProject),
  isOldLayoutEligible: () => ipcRenderer.invoke("is-old-layout-eligible"),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  readPickedFile: (token, path) => ipcRenderer.invoke("read-picked-file", token, path),
  releasePickedFiles: (token) => ipcRenderer.invoke("release-picked-files", token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  setForceFocus: (enabled) => ipcRenderer.invoke("set-force-focus", enabled),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),
}

contextBridge.exposeInMainWorld("api", api)
