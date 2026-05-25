// 诊断第 1 节 "...都可审计、可" 行末为啥无 overlay 覆盖
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

// 设选区:段 1 全选(从 "作为" 到 "主动权")— 用户图 16 显示选区到 SSH 远程开发,但我先模拟覆盖 section1 全部
console.log("Setting selection to cover section 1 fully (作为 → SSH远程开发)...")
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    if (!s.textContent || !s.textContent.trim()) return false
    return s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE
  })
  const startSpan = spans.find(s => s.textContent.includes("作为"))
  // 模拟 user 截图选区 — 可能止于 "不确定风险" 这附近
  const endSpan = spans.find(s => s.textContent.includes("不确定风险"))
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
})()`)

// 找含 "都可审计" 的 span + 同行所有 spans + 对应 overlay
const r = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const allSpans = Array.from(tl.querySelectorAll("span"))
  const target = allSpans.find(s => (s.textContent || "").includes("都可审计") && s.getBoundingClientRect().width > 0)
  if (!target) return JSON.stringify({ error: "no target" })
  const tr = target.getBoundingClientRect()
  const targetCy = tr.top + tr.height / 2
  // 同行所有 spans
  const lineSpans = allSpans.filter(s => {
    const r = s.getBoundingClientRect()
    if (r.width <= 0) return false
    const cy = r.top + r.height / 2
    return Math.abs(cy - targetCy) <= 10
  }).map(s => {
    const r = s.getBoundingClientRect()
    return { text: s.textContent, x: Math.round(r.left), w: Math.round(r.width), right: Math.round(r.right), cy: Math.round(r.top + r.height/2) }
  }).sort((a, b) => a.x - b.x)
  // 所有 overlay rects(找跟 target y 接近的)
  const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]')).map(d => ({
    x: Math.round(parseFloat(d.style.left)),
    y: Math.round(parseFloat(d.style.top)),
    h: Math.round(parseFloat(d.style.height)),
    w: Math.round(parseFloat(d.style.width)),
    right: Math.round(parseFloat(d.style.left) + parseFloat(d.style.width)),
  }))
  const sameRowOverlays = overlays.filter(o => Math.abs((o.y + o.h/2) - targetCy) <= 10)
  // native selection rects
  const sel = window.getSelection()
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const nativeRects = range ? Array.from(range.getClientRects()).map(r => ({
    x: Math.round(r.left), right: Math.round(r.right), cy: Math.round(r.top + r.height/2), w: Math.round(r.width)
  })).filter(r => Math.abs(r.cy - targetCy) <= 10) : []
  // 整个 native selection bbox
  const allNativeRects = range ? Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0) : []
  let bboxTop = Infinity, bboxBottom = -Infinity
  for (const r of allNativeRects) { if (r.top < bboxTop) bboxTop = r.top; if (r.bottom > bboxBottom) bboxBottom = r.bottom }
  // 第一个/最后一个 native rect(用来推 selStartX / selEndX)
  const sortedNative = [...allNativeRects].sort((a, b) => a.top - b.top || a.left - b.left)
  return JSON.stringify({
    targetCy: Math.round(targetCy),
    lineSpans,
    sameRowOverlays,
    sameRowNativeRects: nativeRects,
    bboxTop: Math.round(bboxTop),
    bboxBottom: Math.round(bboxBottom),
    selStartCy: sortedNative[0] ? Math.round(sortedNative[0].top + sortedNative[0].height/2) : null,
    selEndCy: sortedNative.length ? Math.round(sortedNative[sortedNative.length-1].top + sortedNative[sortedNative.length-1].height/2) : null,
    selStartX: sortedNative[0] ? Math.round(sortedNative[0].left) : null,
    selEndX: sortedNative.length ? Math.round(sortedNative[sortedNative.length-1].right) : null,
  })
})()`)

const data = JSON.parse(r)
console.log("\n=== target 行 cy =", data.targetCy, "===")
console.log("\n同行 spans 按 x 排序:")
for (const s of data.lineSpans) {
  console.log("  " + JSON.stringify(s.text.slice(0, 40)).padEnd(50) + " x=" + s.x + " right=" + s.right + " w=" + s.w + " cy=" + s.cy)
}
console.log("\n同行 overlay rects:")
for (const o of data.sameRowOverlays) console.log("  x=" + o.x + " right=" + o.right + " w=" + o.w + " y=" + o.y + " h=" + o.h)
console.log("\n同行 native selection rects:")
for (const r of data.sameRowNativeRects) console.log("  x=" + r.x + " right=" + r.right + " w=" + r.w)
console.log("\n选区整体:")
console.log("  bbox top/bottom:", data.bboxTop, "/", data.bboxBottom)
console.log("  selStartCy/EndCy:", data.selStartCy, "/", data.selEndCy)
console.log("  selStartX/EndX:", data.selStartX, "/", data.selEndX)
