// FORK: CDP 截屏 + dump 视觉 spans 状态 — 看选区为啥还有漏字
// 1. 程序设 selection(模拟 user 拖选)
// 2. 截屏存盘
// 3. dump 所有 textLayer span 的:bbox 位置 / 是否在 native selection / 是否在 Provider 视觉算法 hits / 是否在 overlay rects
// [feat: office-选中加聊天] 2026-05-25

import { writeFileSync } from "node:fs"

const CDP = "http://localhost:9222"
const pages = await (await fetch(`${CDP}/json`)).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))

function send(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws)
    let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("ws timeout")) }, 15000)
    w.addEventListener("open", () => w.send(JSON.stringify({ id, method, params })))
    w.addEventListener("message", e => {
      clearTimeout(t)
      const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
      if (m.id === id) { try { w.close() } catch {}; if (m.error) rej(new Error(m.error.message)); else res(m.result) }
    })
    w.addEventListener("error", rej)
  })
}
const ws = dpage.webSocketDebuggerUrl
async function ev(expr) {
  const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

// 1. 设 selection — 中段拖选
console.log("Setting programmatic selection...")
const setupResult = await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    const t = s.textContent
    if (!t || !t.trim()) return false
    if (!s.firstChild || s.firstChild.nodeType !== Node.TEXT_NODE) return false
    return true
  })
  const a = spans[Math.floor(spans.length * 0.15)], b = spans[Math.floor(spans.length * 0.55)]
  const range = document.createRange()
  range.setStart(a.firstChild, 0)
  range.setEnd(b.firstChild, b.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
  return JSON.stringify({
    nativeLen: sel.toString().length,
    aText: a.textContent,
    bText: b.textContent
  })
})()`)
console.log("Selection:", setupResult)

// 2. 截屏
console.log("\nTaking screenshot...")
const shot = await send(ws, "Page.captureScreenshot", { format: "png" })
const shotPath = "D:/tmp/deskfox-selection-snapshot.png"
writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
console.log(`Saved: ${shotPath}`)

// 3. dump 所有 textLayer 内 spans + 视觉算法 hit + overlay rect 状态
console.log("\nDumping span states...")
const dump = await ev(`(() => {
  const sel = window.getSelection()
  const nativeText = sel ? sel.toString() : ""
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  if (!range) return JSON.stringify({ error: "no range" })

  // bbox of native selection
  const nativeRects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
  let bboxTop = Infinity, bboxBottom = -Infinity
  for (const r of nativeRects) {
    if (r.top < bboxTop) bboxTop = r.top
    if (r.bottom > bboxBottom) bboxBottom = r.bottom
  }

  // 视口内可见 textLayer
  const allTl = Array.from(document.querySelectorAll(".textLayer"))
  const visTl = allTl.find(tl => {
    const r = tl.getBoundingClientRect()
    return r.bottom > 0 && r.top < window.innerHeight && r.width > 0
  })
  if (!visTl) return JSON.stringify({ error: "no visible textLayer" })

  // 所有 spans in visTl
  const allSpans = Array.from(visTl.querySelectorAll("span"))
  // overlay rects 的 left/top 集合(用来判定哪些 spans 实际被 overlay 覆盖)
  const overlayDivs = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]'))
  const overlayPosSet = new Set(overlayDivs.map(d => Math.round(parseFloat(d.style.left)) + "/" + Math.round(parseFloat(d.style.top))))

  // 分类每个 span
  const spanDetails = allSpans.map((s, idx) => {
    const r = s.getBoundingClientRect()
    const t = s.textContent || ""
    const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0
    if (!inViewport) return null
    const cy = r.top + r.height / 2
    const inBboxY = cy >= bboxTop && cy <= bboxBottom
    const inNative = range.intersectsNode(s)
    const overlayHit = overlayPosSet.has(Math.round(r.left) + "/" + Math.round(r.top))
    const filteredAsText = !t || !t.trim()  // 我的算法用 t.trim() 过滤
    return {
      idx,
      text: t,
      hasText: !!t.trim(),
      width: Math.round(r.width),
      height: Math.round(r.height),
      x: Math.round(r.left),
      y: Math.round(r.top),
      cy: Math.round(cy),
      inBboxY,
      inNative,
      overlayHit,
      // Provider 算法判定:in bbox + non-empty trim + visible rect
      shouldBeHit: inBboxY && !filteredAsText && r.width > 0 && r.height > 0,
    }
  }).filter(x => x)

  // 视觉中漏的 spans = inBboxY 但 overlayHit=false
  const missedFromOverlay = spanDetails.filter(s => s.inBboxY && s.shouldBeHit && !s.overlayHit)
  const filteredWhitespace = spanDetails.filter(s => s.inBboxY && !s.hasText)

  return JSON.stringify({
    nativeTextLen: nativeText.length,
    bboxTop: Math.round(bboxTop),
    bboxBottom: Math.round(bboxBottom),
    totalVisibleSpans: spanDetails.length,
    spansInBboxY: spanDetails.filter(s => s.inBboxY).length,
    spansShouldBeHit: spanDetails.filter(s => s.shouldBeHit).length,
    overlayRectsCount: overlayDivs.length,
    missedFromOverlayCount: missedFromOverlay.length,
    missedSample: missedFromOverlay.slice(0, 15).map(s => ({ text: s.text.slice(0, 30), y: s.y, x: s.x, w: s.width, h: s.height })),
    filteredWhitespaceCount: filteredWhitespace.length,
    filteredWhitespaceSample: filteredWhitespace.slice(0, 10).map(s => ({ text: JSON.stringify(s.text), y: s.y, w: s.width, h: s.height })),
  })
})()`)
console.log(dump)
