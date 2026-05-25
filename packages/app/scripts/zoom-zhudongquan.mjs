// 聚焦"模型供应商...让开发者真正掌握"用什么模型..."主动权" 这一行,高清裁剪
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

// 先设选区(段落 1 全选)
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    if (!s.textContent || !s.textContent.trim()) return false
    return s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE
  })
  const startSpan = spans.find(s => s.textContent.includes("作为"))
  const endSpan = spans.find(s => s.textContent.includes("主动权"))
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
})()`)

// 拿"模型供应商...主动权" 行的 bbox
const lineBbox = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span"))
  const mxqs = spans.find(s => s.textContent.includes("模型供应商，让开发者真正掌握") && s.getBoundingClientRect().width > 0)
  const zhuDQ = spans.find(s => s.textContent.includes("的主动权") && s.getBoundingClientRect().width > 0)
  if (!mxqs || !zhuDQ) return null
  const r1 = mxqs.getBoundingClientRect()
  const r2 = zhuDQ.getBoundingClientRect()
  return JSON.stringify({
    left: Math.min(r1.left, r2.left),
    right: Math.max(r1.right, r2.right),
    top: Math.min(r1.top, r2.top),
    bottom: Math.max(r1.bottom, r2.bottom),
  })
})()`)
const b = JSON.parse(lineBbox)
console.log("Line bbox:", b)

const pad = 8
const clip = { x: Math.max(0, b.left - pad), y: Math.max(0, b.top - pad), width: b.right - b.left + pad * 2, height: b.bottom - b.top + pad * 2, scale: 2 }
const shot = await send("Page.captureScreenshot", { format: "png", clip })
writeFileSync("D:/tmp/deskfox-zhudongquan-zoom.png", Buffer.from(shot.data, "base64"))
console.log("Saved zoom: D:/tmp/deskfox-zhudongquan-zoom.png")
