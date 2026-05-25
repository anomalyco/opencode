// 给所有 textLayer span 加红色边框,看 span 位置 vs canvas 可见文字位置
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

// 清空 selection, 清掉 overlay 干扰
await ev(`(() => {
  window.getSelection()?.removeAllRanges()
  document.querySelectorAll('[data-slot="selection-overlay-rect"]').forEach(d => d.remove())
  document.querySelectorAll('[data-debug-marker]').forEach(d => d.remove())
  // 给 textLayer span 加红框 (只看可见 + 选区相关 y 范围)
  const tl = document.querySelector(".textLayer")
  tl.querySelectorAll("span").forEach(s => {
    const r = s.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    if (r.top < 580 || r.top > 800) return
    s.style.outline = "1px solid red"
    s.style.outlineOffset = "0"
    s.style.boxSizing = "border-box"
  })
  return "ok"
})()`)

// 截图 line 2-4 区域
const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 900, y: 580, width: 900, height: 200, scale: 3 } })
writeFileSync("D:/tmp/deskfox-textlayer-bounds.png", Buffer.from(r.data, "base64"))
console.log("Saved: D:/tmp/deskfox-textlayer-bounds.png")
