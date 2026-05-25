// 验证 --total-scale-factor 修法后 overlay 覆盖行末
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

// reload — 拿新 build 后的 page
await send("Page.reload", { ignoreCache: true })
await new Promise(r => setTimeout(r, 3500))

// 找 PDF tab 重新点开(reload 后可能 PDF 没自动展开)+ 等 textLayer 渲染
const pdfReady = await ev(`(async () => {
  // 等 textLayer 出现
  for (let i = 0; i < 30; i++) {
    if (document.querySelector(".textLayer")) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
})()`)
console.log("textLayer ready:", pdfReady)

if (!pdfReady) {
  console.log("PDF tab not auto-restored — need user to open PDF file. Exit.")
  process.exit(0)
}

// 验证 --total-scale-factor 已设
const scaleSet = await ev(`(() => {
  const wrap = document.querySelector(".pdf-page-wrapper")
  return getComputedStyle(wrap).getPropertyValue("--total-scale-factor") || "(unset)"
})()`)
console.log("--total-scale-factor:", scaleSet)

// 选区: 作为 → 不确定风险
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    if (!s.textContent || !s.textContent.trim()) return false
    return s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE
  })
  const startSpan = spans.find(s => s.textContent.includes("作为"))
  const endSpan = spans.find(s => s.textContent.includes("不确定风险"))
  if (!startSpan || !endSpan) throw new Error("span not found")
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 700))
})()`)

// 检查 3 个行末 span 是否被 overlay 覆盖
const r = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const targets = ["都可审计", "私有化定制", "不确定风险"]
  const result = []
  for (const tgt of targets) {
    const span = Array.from(tl.querySelectorAll("span")).find(s => (s.textContent||"").includes(tgt) && s.getBoundingClientRect().width > 0)
    if (!span) { result.push({ tgt, error: "no span" }); continue }
    const sr = span.getBoundingClientRect()
    const cy = sr.top + sr.height/2
    const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]')).map(d => {
      const r = d.getBoundingClientRect()
      return { x: Math.round(r.left), right: Math.round(r.right), cy: Math.round(r.top + r.height/2) }
    }).filter(o => Math.abs(o.cy - cy) <= 10)
    const overlayMaxRight = overlays.length ? Math.max(...overlays.map(o => o.right)) : 0
    const covered = overlayMaxRight >= sr.right - 2
    result.push({
      tgt,
      spanRight: Math.round(sr.right),
      overlayMaxRight,
      diff: Math.round(sr.right) - overlayMaxRight,
      covered,
    })
  }
  return JSON.stringify(result, null, 2)
})()`)
console.log("\n=== 行末覆盖检查 ===")
console.log(r)

// 截图 line 2-4 区域
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 900, y: 580, width: 900, height: 200, scale: 3 } })
writeFileSync("D:/tmp/deskfox-after-fix.png", Buffer.from(shot.data, "base64"))
console.log("Screenshot: D:/tmp/deskfox-after-fix.png")
