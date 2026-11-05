/**
 * Freeze (development only, from the device preview): holds Vite's hot updates and full reloads
 * while several people save files, so the page and the preview's frames stay still for recording
 * and review.
 *
 * Vite's client (/@vite/client) gets every update over a WebSocket with the "vite-hmr" protocol,
 * and its listeners ("vite:beforeUpdate", "vite:beforeFullReload") can't cancel one; nor can
 * location.reload be replaced. So `freezeScript`, inlined in the document head before the client
 * loads, wraps WebSocket: while the tab's sessionStorage says frozen, it keeps that socket's update,
 * reload and error messages (and a lost connection, after which Vite reloads) from the client and
 * counts them. The preview's frames share the tab's sessionStorage, so one switch freezes them all.
 * Applying what was held is a single reload of the page, which reloads the frames with it.
 */

export const freezeKey = "opencode-site-freeze"
/** Dispatched on window with the number of held updates. */
export const freezeEvent = "opencode-site-freeze-pending"

declare global {
  interface Window {
    __siteFreeze?: { pending: number }
  }
}

export const freezeScript = `(()=>{
const key=${JSON.stringify(freezeKey)},event=${JSON.stringify(freezeEvent)},Native=window.WebSocket;
const state=window.__siteFreeze={pending:0};
const frozen=()=>{try{return sessionStorage.getItem(key)==="1"}catch{return false}};
const held=new Set(["update","full-reload","prune","error"]);
const hold=()=>{state.pending++;dispatchEvent(new CustomEvent(event,{detail:state.pending}))};
window.WebSocket=new Proxy(Native,{construct(target,args){
const socket=new target(...args);
if(args[1]!=="vite-hmr")return socket;
const add=socket.addEventListener.bind(socket);
socket.addEventListener=(type,listener,options)=>{
const call=(e)=>typeof listener==="function"?listener.call(socket,e):listener.handleEvent(e);
if(type==="message")return add(type,(e)=>{
if(frozen()){let type;try{type=JSON.parse(e.data).type}catch{}if(held.has(type))return hold()}
call(e)},options);
if(type==="close")return add(type,(e)=>{if(frozen())return hold();call(e)},options);
return add(type,listener,options)};
return socket}});
})()`

export function isFrozen() {
  return sessionStorage.getItem(freezeKey) === "1"
}

export function pendingUpdates() {
  return window.__siteFreeze?.pending ?? 0
}

export function setFrozen(on: boolean) {
  if (on) return sessionStorage.setItem(freezeKey, "1")
  sessionStorage.removeItem(freezeKey)
  // Unfreezing applies what was held, once.
  if (pendingUpdates() > 0) location.reload()
}
