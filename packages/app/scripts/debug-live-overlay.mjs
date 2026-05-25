// Debug — set selection programmatically, see if live overlay renders
const CDP = "http://localhost:9222"
const pages = await (await fetch(`${CDP}/json`)).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))

function send(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws)
    let id = 1
    const timer = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 10000)
    w.addEventListener("open", () => w.send(JSON.stringify({ id, method, params })))
    w.addEventListener("message", e => {
      clearTimeout(timer)
      const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
      if (m.id === id) { try { w.close() } catch {}; if (m.error) rej(new Error(m.error.message)); else res(m.result) }
    })
    w.addEventListener("error", rej)
  })
}

const ws = dpage.webSocketDebuggerUrl
async function ev(expr) {
  const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    console.error("eval exception:", JSON.stringify(r.exceptionDetails))
    throw new Error("eval failed")
  }
  return r.result.value
}

console.log("=== Mount check ===")
const mount = await ev(`JSON.stringify({
  pdfViewer: document.querySelectorAll('[data-slot="pdf-viewer"]').length,
  chatLog: document.querySelectorAll('[data-slot="session-turn-list"]').length,
  contextMenuHostMenu: document.querySelectorAll('[data-slot="context-menu-host"]').length,
  overlayRects: document.querySelectorAll('[data-slot="selection-overlay-rect"]').length,
  bodyHasRgba209: document.body.outerHTML.includes("rgba(209"),
  // 看 message-timeline 是否在 DOM 里(它把 ChatSelectionMenu mount 在最后)
  messageTimelineMarker: document.querySelectorAll('[data-component="message-timeline"], [data-component="chat-timeline"]').length,
  // 看 contextmenu listener 是否注册(Solid 没法直接查,但若 host 没 mount 那右键无菜单)
  // 看当前 URL pathname
  url: location.href,
  // 看页面顶层组件
  bodyChildren: Array.from(document.body.children).map(c => c.tagName + '.' + (c.className || '').toString().slice(0,40)).slice(0,5)
})`)
console.log(mount)

console.log("\n=== Programmatically set selection + check overlay ===")
const result = await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => s.textContent && s.textContent.trim())
  const a = spans[10], b = spans[30]
  const range = document.createRange()
  range.setStart(a.firstChild, 0)
  range.setEnd(b.firstChild, b.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 300))
  return JSON.stringify({
    selLen: sel.toString().length,
    selFirst60: sel.toString().slice(0, 60),
    overlayRects: document.querySelectorAll('[data-slot="selection-overlay-rect"]').length,
    bodyHasRgba209: document.body.outerHTML.includes("rgba(209"),
    rgba209Count: (document.body.outerHTML.match(/rgba\\(209/g) || []).length
  })
})()`)
console.log(result)

console.log("\n=== 右键查 contextmenu host 是否 mount + listener 触发 ===")
const target = await ev(`(() => {
  const tl = document.querySelector('.textLayer')
  const spans = Array.from(tl.querySelectorAll('span')).filter(s => s.textContent && s.textContent.trim())
  const sp = spans[20]
  const r = sp.getBoundingClientRect()
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
})()`)
const t = JSON.parse(target)
await send(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(t.x), y: Math.round(t.y), button: "none" })
await send(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(t.x), y: Math.round(t.y), button: "right", clickCount: 1 })
await send(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(t.x), y: Math.round(t.y), button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 400))

const menuCheck = await ev(`JSON.stringify({
  menuOpen: document.querySelectorAll('[data-slot="context-menu-host"]').length,
  overlayRects: document.querySelectorAll('[data-slot="selection-overlay-rect"]').length,
  rgba209Count: (document.body.outerHTML.match(/rgba\\(209/g) || []).length
})`)
console.log("After right-click:", menuCheck)
