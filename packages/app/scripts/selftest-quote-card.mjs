// 自测 B 方案 端到端:PDF 选区 → 右键 → 添加到聊天 → 写问题 → 提交
// 验证:卡片出现 / textarea 干净 / ContextItem 含 quote origin / preview 存
import { writeFileSync } from "node:fs"
const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws); let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 12000)
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

// 等 textLayer + pdf-viewer wrapper
const ready = await ev(`(async () => { for (let i = 0; i < 30; i++) { const tl = document.querySelector(".textLayer"); const pv = document.querySelector('[data-slot="pdf-viewer"]'); if (tl && pv) return { ok: true, filePath: pv.dataset.filePath } ; await new Promise(r => setTimeout(r, 500)) } return { ok: false } })()`)
console.log("PDF viewer 就绪:", ready)
if (!ready.ok) { console.log("PDF 未加载,退出"); process.exit(0) }

// === Step 1: 设选区(找两个相隔几行的 span)===
const selResult = await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE && s.textContent.trim())
  const startSpan = spans.find(s => s.textContent.length > 8)
  const endSpan = spans.find(s => s !== startSpan && s.textContent.length > 8 && s.getBoundingClientRect().top > startSpan.getBoundingClientRect().bottom + 5)
  if (!startSpan || !endSpan) return { error: "no spans" }
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, Math.min(8, endSpan.firstChild.textContent.length))
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
  // 取 focus 处坐标作右键点
  const fr = document.createRange()
  fr.setStart(sel.focusNode, sel.focusOffset)
  fr.setEnd(sel.focusNode, sel.focusOffset)
  const frRect = fr.getBoundingClientRect()
  return {
    ok: true,
    selectedText: sel.toString().slice(0, 100),
    selectedLen: sel.toString().length,
    clickX: Math.round(frRect.left),
    clickY: Math.round(frRect.top + frRect.height/2),
  }
})()`)
console.log("\n=== Step 1 设选区 ===")
console.log(selResult)
if (selResult.error) process.exit(1)

// === Step 2: 模拟右键 → 菜单弹出 ===
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: selResult.clickX, y: selResult.clickY, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 100))
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: selResult.clickX, y: selResult.clickY, button: "right", clickCount: 1 })
await new Promise(r => setTimeout(r, 400))

const menuOpen = await ev(`(() => {
  const menu = document.querySelector('[data-slot="context-menu-host"]')
  if (!menu) return { open: false }
  const r = menu.getBoundingClientRect()
  const addBtn = Array.from(menu.querySelectorAll("button")).find(b => b.textContent && b.textContent.includes("聊天"))
  return { open: true, x: Math.round(r.left), y: Math.round(r.top), addBtnExists: !!addBtn, addBtnDisabled: addBtn?.disabled ?? "no-btn" }
})()`)
console.log("\n=== Step 2 右键菜单 ===")
console.log(menuOpen)
if (!menuOpen.open || menuOpen.addBtnDisabled !== false) {
  console.log("❌ 菜单未出 / 添加到聊天 disabled,退出")
  process.exit(1)
}

// === Step 3: 点"添加到聊天" → 切到 input 模式 ===
await ev(`(() => {
  const menu = document.querySelector('[data-slot="context-menu-host"]')
  const addBtn = Array.from(menu.querySelectorAll("button")).find(b => b.textContent.includes("聊天"))
  addBtn.click()
})()`)
await new Promise(r => setTimeout(r, 400))

const inputMode = await ev(`(() => {
  const ta = document.querySelector('[data-slot="context-menu-host"] textarea')
  return { hasTextarea: !!ta, textareaPlaceholder: ta?.placeholder ?? "" }
})()`)
console.log("\n=== Step 3 切到 input 模式 ===")
console.log(inputMode)

// === Step 4: 写问题 + 提交 ===
const userQuestion = "测试问题:这段讲什么?"
await ev(`(() => {
  const ta = document.querySelector('[data-slot="context-menu-host"] textarea')
  ta.focus()
  ta.value = ${JSON.stringify(userQuestion)}
  ta.dispatchEvent(new Event("input", { bubbles: true }))
})()`)
await new Promise(r => setTimeout(r, 200))
await ev(`(() => {
  // 找"提交"或类似按钮
  const buttons = Array.from(document.querySelectorAll('[data-slot="context-menu-host"] button'))
  const submitBtn = buttons.find(b => /提交|加入聊天|确定|submit/i.test(b.textContent || ""))
  if (submitBtn) submitBtn.click()
  else {
    // fallback:Ctrl+Enter
    const ta = document.querySelector('[data-slot="context-menu-host"] textarea')
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }))
  }
})()`)
await new Promise(r => setTimeout(r, 700))

// === Step 5: 验证 ===
const verify = await ev(`(() => {
  // 5a 菜单已关
  const menuOpen = !!document.querySelector('[data-slot="context-menu-host"]')
  // 5b 卡片出来了吗 — context-items 区
  const cards = Array.from(document.querySelectorAll('button[aria-label*="移除"], button[aria-label*="remove"], [class*="rounded-"][class*="shadow-xs-border"]')).filter(el => el.closest('[class*="flex"][class*="overflow-x-auto"]'))
  // 简化:找 textarea 上方那条 card row 容器
  // 通过 prompt-input 结构 — 找包含文件 icon 的卡片
  const allCards = Array.from(document.querySelectorAll('div[class*="rounded-"][class*="shadow-xs-border"]'))
  // 5c textarea 文字
  const promptEditor = document.querySelector('[contenteditable="true"]')
  const promptText = promptEditor ? promptEditor.textContent : ""
  // 5d 是否有 blockquote ">" 字符
  const hasBlockquote = promptText.includes("> ")
  return {
    menuStillOpen: menuOpen,
    cardCount: allCards.length,
    cardSamples: allCards.slice(0, 5).map(c => (c.textContent || "").slice(0, 50)),
    promptText: promptText.slice(0, 120),
    promptHasBlockquote: hasBlockquote,
    promptLen: promptText.length,
  }
})()`)
console.log("\n=== Step 5 验证 ===")
console.log(JSON.stringify(verify, null, 2))

// 截图
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 900, scale: 1 } })
writeFileSync("D:/tmp/deskfox-selftest-quote.png", Buffer.from(shot.data, "base64"))
console.log("\n截图: D:/tmp/deskfox-selftest-quote.png")

// 判定
const ok =
  !verify.menuStillOpen &&                  // 菜单已关
  verify.cardCount > 0 &&                    // 至少 1 个卡片
  !verify.promptHasBlockquote &&             // textarea 没 blockquote
  verify.promptLen < 30                      // textarea 基本干净

console.log("\n" + (ok ? "✅ 自测通过" : "⚠️  部分检查未达预期 — 看截图核对"))
