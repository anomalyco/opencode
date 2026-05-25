// 聚焦截 prompt 输入区 + 上方卡片区
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}

// 找 prompt input 区 + 上方卡片区 bbox
const bbox = await ev(`(() => {
  // prompt-input 容器
  const promptEditor = document.querySelector('[contenteditable="true"]')
  if (!promptEditor) return null
  // 往上找包含卡片区 + textarea 的容器
  let container = promptEditor
  for (let i = 0; i < 6; i++) container = container.parentElement
  const r = container.getBoundingClientRect()
  return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height })
})()`)
if (!bbox) { console.log("no prompt editor"); process.exit(0) }
const b = JSON.parse(bbox)
console.log("prompt 区 bbox:", b)

const clip = { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: b.w + 20, height: b.h + 20, scale: 2 }
const shot = await send("Page.captureScreenshot", { format: "png", clip })
writeFileSync("D:/tmp/deskfox-prompt-card.png", Buffer.from(shot.data, "base64"))
console.log("Saved: D:/tmp/deskfox-prompt-card.png")
