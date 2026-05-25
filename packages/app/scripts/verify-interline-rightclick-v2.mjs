// 验证 v2:找选区内真正的行间空白点(line 2 与 line 3 之间),不是段间
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

// 先关掉前一轮可能开的菜单
await ev(`(() => { const m = document.querySelector('[data-slot="context-menu-host"]'); if (m) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })) } window.getSelection()?.removeAllRanges() })()`)

const setup = await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => s.textContent && s.textContent.trim() && s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE)
  // 选区:从段 1 (完全开源 body line 1) 到 line 3
  const startSpan = spans.find(s => s.textContent.includes("opencode") && s.getBoundingClientRect().width > 0)
  const endSpan = spans.find(s => s.textContent.includes("不必担心代码"))
  if (!startSpan || !endSpan) return JSON.stringify({ error: "spans not found" })
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 700))

  // 找选区内连续 lines 之间的 gap
  const allSpans = Array.from(tl.querySelectorAll("span"))
  const lines = []
  for (const s of allSpans) {
    const r = s.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (r.top < 600 || r.top > 750) continue // 限 paragraph 1 body 区域
    const existing = lines.find(L => Math.abs(L.cy - (r.top + r.height/2)) < 5)
    if (existing) {
      existing.left = Math.min(existing.left, r.left)
      existing.right = Math.max(existing.right, r.right)
      existing.top = Math.min(existing.top, r.top)
      existing.bottom = Math.max(existing.bottom, r.bottom)
    } else {
      lines.push({ cy: r.top + r.height/2, left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
  }
  lines.sort((a,b) => a.top - b.top)

  // 找连续 line 间的最小 gap(真行间空白,不是段间)
  const gaps = []
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i+1].top - lines[i].bottom
    if (gap > 0 && gap < 30) {
      // 取两行重叠的 x 范围中点
      const xStart = Math.max(lines[i].left, lines[i+1].left)
      const xEnd = Math.min(lines[i].right, lines[i+1].right)
      const midX = (xStart + xEnd) / 2
      const midY = (lines[i].bottom + lines[i+1].top) / 2
      gaps.push({ gap, midX, midY, lineIdx: i })
    }
  }
  return JSON.stringify({ gaps, linesCount: lines.length, lines: lines.map(L => ({ top: Math.round(L.top), bottom: Math.round(L.bottom) })) })
})()`)
const s = JSON.parse(setup)
console.log("行间分析:", JSON.stringify(s, null, 2))

if (!s.gaps || s.gaps.length === 0) {
  console.log("找不到行间空白,退出")
  process.exit(0)
}

const gap = s.gaps[0]
const x = Math.round(gap.midX)
const y = Math.round(gap.midY)
console.log(`\n模拟右键于行间空白 (${x}, ${y}),gap=${gap.gap}px`)

// 先验证 snapshot 前 selection 仍在
const beforeSel = await ev(`(() => { const s = window.getSelection(); return { rc: s.rangeCount, text: s.toString().slice(0, 30), len: s.toString().length } })()`)
console.log("点击前 selection:", beforeSel)

await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 100))
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 300))

const menuStatus = await ev(`(() => {
  const menu = document.querySelector('[data-slot="context-menu-host"]')
  if (!menu) return { open: false }
  const r = menu.getBoundingClientRect()
  // 找 "添加到聊天" button 看是否 disabled
  const addBtn = Array.from(menu.querySelectorAll("button")).find(b => b.textContent && b.textContent.includes("聊天"))
  const copyBtn = Array.from(menu.querySelectorAll("button")).find(b => b.textContent && b.textContent.includes("复制"))
  return {
    open: true,
    x: Math.round(r.left),
    y: Math.round(r.top),
    addBtnDisabled: addBtn ? addBtn.disabled : "no-btn",
    copyBtnDisabled: copyBtn ? copyBtn.disabled : "no-btn",
  }
})()`)
console.log("\n=== 行间空白右键后菜单状态 ===")
console.log(menuStatus)

const afterSel = await ev(`(() => { const s = window.getSelection(); return { rc: s.rangeCount, text: s.toString().slice(0, 30), len: s.toString().length } })()`)
console.log("点击后 native selection:", afterSel)
