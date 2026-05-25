// 找当前页用的 viewport scale
const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws); let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 10000)
    w.addEventListener("open", () => w.send(JSON.stringify({ id, method, params })))
    w.addEventListener("message", e => { clearTimeout(t); const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)); if (m.id === id) { try { w.close() } catch {}; if (m.error) rej(new Error(m.error.message)); else res(m.result) } })
    w.addEventListener("error", rej)
  })
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

const r = await ev(`(() => {
  const wrap = document.querySelector(".pdf-page-wrapper")
  const canvas = wrap.querySelector("canvas")
  const tl = wrap.querySelector(".textLayer")
  return JSON.stringify({
    wrapStyleWidth: wrap.style.width,
    wrapStyleHeight: wrap.style.height,
    canvasStyleWidth: canvas.style.width,
    canvasStyleHeight: canvas.style.height,
    canvasIntrinsicW: canvas.width,
    canvasIntrinsicH: canvas.height,
    tlStyleWidth: tl.style.width,
    tlStyleHeight: tl.style.height,
    tlComputedWidth: getComputedStyle(tl).width,
    devicePixelRatio: window.devicePixelRatio,
  }, null, 2)
})()`)
console.log(r)
