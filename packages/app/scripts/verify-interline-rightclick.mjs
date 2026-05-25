// 验证:行间空白右键 → 应能恢复 snapshot 选区 + 开菜单
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

// 等 textLayer
await ev(`(async () => { for (let i = 0; i < 30; i++) { if (document.querySelector(".textLayer")) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)

// 设选区 multi-line + 拿行间空白坐标
const setup = await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => s.textContent && s.textContent.trim() && s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE)
  const startSpan = spans.find(s => s.textContent.includes("作为"))
  const endSpan = spans.find(s => s.textContent.includes("不确定风险"))
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))

  // 找 2 行(不连续 cy)中间的空白:取 line2 bottom + line3 top 中间点
  const allSpans = Array.from(tl.querySelectorAll("span"))
  const byY = new Map()
  for (const s of allSpans) {
    const r = s.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    const cy = Math.round((r.top + r.height/2)/5)*5
    if (!byY.has(cy)) byY.set(cy, { top: r.top, bottom: r.bottom, lefts: [] })
    byY.get(cy).lefts.push(r.left)
  }
  // 拿到选区覆盖的连续行
  const lines = Array.from(byY.entries()).map(([cy, v]) => ({ cy, ...v })).sort((a,b)=>a.cy-b.cy)
  // 找两行间隙最大的(行间空白)— 找 line 之间 bottom→next top gap
  let bestGap = null
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i+1].top - lines[i].bottom
    if (gap > 0 && gap > (bestGap?.gap || 0)) bestGap = { gap, midY: (lines[i].bottom + lines[i+1].top)/2, midX: 1100 }
  }
  return JSON.stringify({ gapX: bestGap?.midX, gapY: bestGap?.midY, gapSize: bestGap?.gap })
})()`)
const s = JSON.parse(setup)
console.log("行间空白点:", s)

// 模拟右键 pointerdown + contextmenu 在行间空白
const x = Math.round(s.gapX)
const y = Math.round(s.gapY)

// 用 CDP Input.dispatchMouseEvent 模拟 right-click
// 注意:button=2 不一定触发 native selection collapse(CDP 合成事件 vs 真 mouse)
// 先 pointerdown(虽然 Input 不直接发 pointerdown,但 mousePressed 会触发 pointerdown + mousedown)
await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 100))
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 300))

// 检查菜单是否弹出
const menuOpen = await ev(`(() => {
  const menu = document.querySelector('[data-slot="context-menu-host"]')
  if (!menu) return { open: false }
  const r = menu.getBoundingClientRect()
  const text = menu.textContent
  return { open: true, x: Math.round(r.left), y: Math.round(r.top), text: text.slice(0, 80) }
})()`)
console.log("菜单状态:", menuOpen)

// snapshot 是否回退
const selStatus = await ev(`(() => {
  const sel = window.getSelection()
  return { rangeCount: sel.rangeCount, text: sel.toString().slice(0, 50) }
})()`)
console.log("native selection:", selStatus)
