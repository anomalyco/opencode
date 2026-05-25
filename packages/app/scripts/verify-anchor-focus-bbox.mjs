// 验证 anchor/focus 边界:模拟 user 拖几行 → overlay 应只覆盖那几行(不扩大到整页)
import { writeFileSync } from "node:fs"
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

await ev(`(async () => { for (let i = 0; i < 30; i++) { if (document.querySelector(".textLayer")) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)

// 模拟 user 拖拽:从"单一" 到 "Claude" — anchor=单一,focus=Claude
// (跟用户 screenshot 一致的场景)
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE)
  // 找"单一模型"span 和"Claude，快速补全"或类似 Claude span
  const startSpan = spans.find(s => (s.textContent||"").includes("单一模型"))
  const endSpan = spans.find(s => /Claude.*快速|快速补全用 Claude/.test(s.textContent || ""))
  if (!startSpan || !endSpan) {
    console.error("test span not found, try 不绑定 / Claude")
  }
  const realStart = startSpan || spans.find(s => (s.textContent||"").includes("不绑定"))
  const realEnd = endSpan || spans.find(s => /Claude/.test(s.textContent||""))
  if (!realStart || !realEnd) return JSON.stringify({ error: "no spans" })
  const range = document.createRange()
  // 关键:让 anchor 在 realStart 的"单一"位置(找 offset)
  const startText = realStart.textContent
  const startOffset = startText.indexOf("单一")
  range.setStart(realStart.firstChild, startOffset >= 0 ? startOffset : 0)
  const endText = realEnd.textContent
  const endOffset = endText.indexOf("Claude")
  range.setEnd(realEnd.firstChild, endOffset >= 0 ? endOffset + "Claude".length : endText.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 700))
  return JSON.stringify({
    anchorText: realStart.textContent.slice(0, 30),
    focusText: realEnd.textContent.slice(0, 30),
    startOffset, endOffset,
  })
})()`)

// 触发右键(于"Claude"附近)看 overlay
const dump = await ev(`(() => {
  const sel = window.getSelection()
  // 拿 anchor / focus 的 caret rect
  const ar = document.createRange()
  ar.setStart(sel.anchorNode, sel.anchorOffset)
  ar.setEnd(sel.anchorNode, sel.anchorOffset)
  const arRect = ar.getBoundingClientRect()
  const fr = document.createRange()
  fr.setStart(sel.focusNode, sel.focusOffset)
  fr.setEnd(sel.focusNode, sel.focusOffset)
  const frRect = fr.getBoundingClientRect()
  // native rects bbox(看 vs anchor/focus 的差距 — 复现 bug)
  const nativeRects = Array.from(sel.getRangeAt(0).getClientRects()).filter(r => r.width > 0)
  let nbT = Infinity, nbB = -Infinity
  for (const r of nativeRects) { if (r.top < nbT) nbT = r.top; if (r.bottom > nbB) nbB = r.bottom }
  return JSON.stringify({
    anchorXY: { x: Math.round(arRect.left), y: Math.round(arRect.top + arRect.height/2), h: Math.round(arRect.height) },
    focusXY: { x: Math.round(frRect.left), y: Math.round(frRect.top + frRect.height/2), h: Math.round(frRect.height) },
    nativeBboxY: { top: Math.round(nbT), bottom: Math.round(nbB), spanCount: nativeRects.length },
  }, null, 2)
})()`)
console.log("=== Selection 边界对比 ===")
console.log(dump)

// 现在右键触发 menu + overlay
const data = JSON.parse(dump)
const rx = data.focusXY.x
const ry = data.focusXY.y
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rx, y: ry, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 100))
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rx, y: ry, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 400))

// 检查 overlay y 范围
const overlay = await ev(`(() => {
  const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]')).map(d => {
    const r = d.getBoundingClientRect()
    return { x: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }
  })
  let t = Infinity, b = -Infinity
  for (const o of overlays) { if (o.top < t) t = o.top; if (o.bottom > b) b = o.bottom }
  return JSON.stringify({ count: overlays.length, top: t, bottom: b, sample: overlays.slice(0, 3) })
})()`)
console.log("\n=== Overlay 实际范围 ===")
console.log(overlay)

const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 1 } })
writeFileSync("D:/tmp/deskfox-anchor-focus-test.png", Buffer.from(shot.data, "base64"))
console.log("\n截图: D:/tmp/deskfox-anchor-focus-test.png")
