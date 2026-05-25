// Zoom into "都可审计、可" 这一行,高清看是否真无 overlay
import { writeFileSync } from "node:fs"
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

// 设选区止于"不确定风险"(模拟 user)
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
  await new Promise(r => setTimeout(r, 500))
})()`)

const bbox = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const target = Array.from(tl.querySelectorAll("span")).find(s => (s.textContent||"").includes("都可审计") && s.getBoundingClientRect().width > 0)
  if (!target) return null
  const r = target.getBoundingClientRect()
  return JSON.stringify({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
})()`)
const b = JSON.parse(bbox)
console.log("target span bbox:", b)

// 加大右边 padding,看后面"都可审计、可"
const padL = 10
const padR = 100
const padY = 10
const clip = { x: Math.max(0, b.left - padL), y: Math.max(0, b.top - padY), width: b.right - b.left + padL + padR, height: b.bottom - b.top + padY * 2, scale: 3 }
const shot = await send("Page.captureScreenshot", { format: "png", clip })
writeFileSync("D:/tmp/deskfox-douke-zoom.png", Buffer.from(shot.data, "base64"))
console.log("Saved: D:/tmp/deskfox-douke-zoom.png (scale 3x)")
