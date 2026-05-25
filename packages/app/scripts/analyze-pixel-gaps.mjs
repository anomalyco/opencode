// FORK: 像素级分析选区 overlay 是否有"天窗"
// 截 selection bbox 裁剪区,分析 row 内 red 像素覆盖率,识别非红色"天窗"
// [feat: office-选中加聊天] 2026-05-25

import { writeFileSync, readFileSync } from "node:fs"

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

// 1. 设 selection
console.log("Set selection...")
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    const t = s.textContent
    if (!t || !t.trim()) return false
    return s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE
  })
  const a = spans[Math.floor(spans.length * 0.15)], b = spans[Math.floor(spans.length * 0.55)]
  const range = document.createRange()
  range.setStart(a.firstChild, 0)
  range.setEnd(b.firstChild, b.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
})()`)

// 2. 拿 overlay rects 的 viewport bbox
const bbox = await ev(`(() => {
  const rects = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]'))
  if (rects.length === 0) return null
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity
  for (const r of rects) {
    const x = parseFloat(r.style.left), y = parseFloat(r.style.top)
    const w = parseFloat(r.style.width), h = parseFloat(r.style.height)
    if (x < minL) minL = x
    if (y < minT) minT = y
    if (x + w > maxR) maxR = x + w
    if (y + h > maxB) maxB = y + h
  }
  return JSON.stringify({
    rectCount: rects.length,
    x: Math.round(minL),
    y: Math.round(minT),
    w: Math.round(maxR - minL),
    h: Math.round(maxB - minT)
  })
})()`)
console.log("Overlay bbox:", bbox)
const b = JSON.parse(bbox)

// 3. 裁剪截屏(只截 overlay bbox + 一点 padding)
const pad = 5
const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2, height: b.h + pad * 2, scale: 1 }
console.log("Clip region:", clip)
const shot = await send(ws, "Page.captureScreenshot", { format: "png", clip })
const shotPath = "D:/tmp/deskfox-overlay-cropped.png"
writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
console.log(`Cropped screenshot saved: ${shotPath}`)
console.log(`File size: ${readFileSync(shotPath).length} bytes`)
