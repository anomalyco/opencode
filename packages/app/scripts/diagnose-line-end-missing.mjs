// 诊断:为什么 "都可审计、可" / "署、私有化定制，" / "不确定风险。" 行末无 overlay
// 核心问题:overlay rect 数据 vs spans 数据 vs 视觉
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

// 设选区:作为 → 不确定风险
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    if (!s.textContent || !s.textContent.trim()) return false
    return s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE
  })
  const startSpan = spans.find(s => s.textContent.includes("作为"))
  const endSpan = spans.find(s => s.textContent.includes("不确定风险"))
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 700))
})()`)

// 找 3 个目标 line:都可审计 / 私有化定制 / 确定风险
const r = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const allSpans = Array.from(tl.querySelectorAll("span"))
  const targets = ["都可审计", "私有化定制", "确定风险"]
  const result = []
  for (const tgt of targets) {
    const span = allSpans.find(s => (s.textContent || "").includes(tgt) && s.getBoundingClientRect().width > 0)
    if (!span) { result.push({ tgt, error: "no span" }); continue }
    const tr = span.getBoundingClientRect()
    const targetCy = tr.top + tr.height / 2
    // 同 cy 行所有 spans (容差 5px 同算法逻辑)
    const lineSpans = allSpans.map(s => {
      const r = s.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      const cy = r.top + r.height / 2
      if (Math.abs(cy - targetCy) > 5) return null
      return { text: s.textContent.slice(0, 30), x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), cy: Math.round(cy), top: Math.round(r.top), bottom: Math.round(r.bottom) }
    }).filter(Boolean).sort((a, b) => a.x - b.x)
    // 自定义同 cy 容差宽到 10px
    const lineSpansWide = allSpans.map(s => {
      const r = s.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      const cy = r.top + r.height / 2
      if (Math.abs(cy - targetCy) > 10) return null
      return { text: s.textContent.slice(0, 30), x: Math.round(r.left), right: Math.round(r.right), cy: Math.round(cy) }
    }).filter(Boolean).sort((a, b) => a.x - b.x)
    // overlay rects 在 ±5px cy 范围内
    const overlayRects = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]')).map(d => {
      const r = d.getBoundingClientRect()
      return { x: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), cy: Math.round(r.top + r.height/2), styleLeft: d.style.left, styleWidth: d.style.width }
    }).filter(o => Math.abs(o.cy - targetCy) <= 10)
    // native selection rects 同 cy 行
    const sel = window.getSelection()
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    const nativeRects = range ? Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0).map(r => ({
      x: Math.round(r.left), right: Math.round(r.right), cy: Math.round(r.top + r.height/2), w: Math.round(r.width)
    })).filter(r => Math.abs(r.cy - targetCy) <= 10).sort((a,b)=>a.x-b.x) : []
    result.push({ tgt, targetCy: Math.round(targetCy), lineSpans, lineSpansWide, overlayRects, nativeRects })
  }
  // 全局 bbox
  const sel = window.getSelection()
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const allNative = range ? Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0) : []
  let bboxTop = Infinity, bboxBottom = -Infinity
  for (const r of allNative) { if (r.top < bboxTop) bboxTop = r.top; if (r.bottom > bboxBottom) bboxBottom = r.bottom }
  result.push({ globalBbox: { bboxTop: Math.round(bboxTop), bboxBottom: Math.round(bboxBottom) } })
  return JSON.stringify(result, null, 2)
})()`)

console.log(r)
