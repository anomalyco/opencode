const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws)
    let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 10000)
    w.addEventListener("open", () => w.send(JSON.stringify({ id, method, params })))
    w.addEventListener("message", e => {
      clearTimeout(t)
      const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
      if (m.id === id) { try { w.close() } catch {}; if (m.error) rej(new Error(m.error.message)); else res(m.result) }
    })
    w.addEventListener("error", rej)
  })
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

const r = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const allSpans = Array.from(tl.querySelectorAll("span"))
  // 同行 (cy ≈ 501) 所有 spans
  const lineY = 501
  const lineSpans = allSpans.filter(s => {
    const r = s.getBoundingClientRect()
    if (r.width <= 0) return false
    const cy = r.top + r.height / 2
    return Math.abs(cy - lineY) <= 10
  }).map(s => {
    const r = s.getBoundingClientRect()
    return { text: s.textContent, x: Math.round(r.left), w: Math.round(r.width), right: Math.round(r.right), cy: Math.round(r.top + r.height/2) }
  }).sort((a, b) => a.x - b.x)
  const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]')).map(d => ({
    x: Math.round(parseFloat(d.style.left)),
    y: Math.round(parseFloat(d.style.top)),
    w: Math.round(parseFloat(d.style.width)),
    right: Math.round(parseFloat(d.style.left) + parseFloat(d.style.width)),
  }))
  const sel = window.getSelection()
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const nativeRects = range ? Array.from(range.getClientRects()).map(r => ({
    x: Math.round(r.left), right: Math.round(r.right), cy: Math.round(r.top + r.height/2), w: Math.round(r.width)
  })) : []
  return JSON.stringify({
    lineSpans,
    overlays,
    nativeRectsAt501: nativeRects.filter(r => Math.abs(r.cy - 501) <= 10),
  })
})()`)

const data = JSON.parse(r)
console.log("同行 (cy=501) spans 按 x 排序:")
for (const s of data.lineSpans) {
  console.log("  " + JSON.stringify(s.text.slice(0, 30)).padEnd(35) + " x=" + s.x + " right=" + s.right + " w=" + s.w + " cy=" + s.cy)
}
console.log("\n所有 overlay rects:")
for (const o of data.overlays) console.log("  x=" + o.x + " right=" + o.right + " y=" + o.y + " w=" + o.w)
console.log("\nnative rects at cy≈501:")
for (const r of data.nativeRectsAt501) console.log("  x=" + r.x + " right=" + r.right + " w=" + r.w + " cy=" + r.cy)
