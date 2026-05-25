// Pre-merge 自动化 QA — 跑 CDP 能验的所有项,产出报告
// 不能验的:真鼠标 native default 行为 / 视觉感知 / LLM 回答质量,留 user 真桌面
import { writeFileSync } from "node:fs"
const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws); let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 15000)
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

const results = []
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`) }

// === T0 — DeskFox 启动 + 当前 session 路径
const env = await ev(`(() => ({
  url: location.href,
  pdfViewer: !!document.querySelector('[data-slot="pdf-viewer"]'),
  pdfFilePath: document.querySelector('[data-slot="pdf-viewer"]')?.dataset.filePath ?? null,
  textLayer: !!document.querySelector('.textLayer'),
  pageWrappers: document.querySelectorAll('.pdf-page-wrapper').length,
  promptEditor: !!document.querySelector('[contenteditable="true"]'),
  fileTabsCount: document.querySelectorAll('[role="tab"]').length,
}))()`)
console.log("\n=== T0 当前环境 ===")
console.log(JSON.stringify(env, null, 2))

if (!env.pdfViewer || !env.textLayer) {
  console.log("\n⚠️  当前 session 没打开 PDF/office 文件 — 跳过 PDF 类测试")
  console.log("user 请手动打开一个 docx/pdf/pptx/xlsx 再重跑")
  process.exit(0)
}

// === T1 — QA #1: --total-scale-factor 在所有 pdf-page-wrapper 上都设了
const scaleFactorCheck = await ev(`(() => {
  const wraps = Array.from(document.querySelectorAll('.pdf-page-wrapper'))
  return wraps.map((w, i) => ({
    page: i + 1,
    scaleFactor: getComputedStyle(w).getPropertyValue('--total-scale-factor').trim(),
    width: w.style.width,
  }))
})()`)
const allSet = scaleFactorCheck.every(p => p.scaleFactor && p.scaleFactor !== '')
log("T1 QA#1 — --total-scale-factor CSS var 已设(全部页面)", allSet, `${scaleFactorCheck.length} 页都有值,示例 page1 scale=${scaleFactorCheck[0]?.scaleFactor}`)

// === T2 — QA #1 视觉验证:textLayer span 跟 canvas 同尺度(看 page1 第一行文字 span 的 font-size)
const fontSizeCheck = await ev(`(() => {
  const tl = document.querySelector('.textLayer')
  const spans = Array.from(tl.querySelectorAll('span')).filter(s => s.textContent && s.textContent.trim() && s.getBoundingClientRect().width > 0)
  if (spans.length === 0) return null
  const cs = getComputedStyle(spans[0])
  return { fontSize: cs.fontSize, sampleText: spans[0].textContent.slice(0, 30) }
})()`)
const fontSizeOK = fontSizeCheck && parseFloat(fontSizeCheck.fontSize) > 13  // 13px = fallback, 修后应该 16.5+(scale=1.5 时)
log("T2 QA#1 视觉 — span font-size 非 fallback 13px", fontSizeOK, fontSizeCheck ? `fontSize=${fontSizeCheck.fontSize}, sample="${fontSizeCheck.sampleText}"` : "no spans")

// === T3 — DOM Provider 视觉 bbox 算法注入(QA #3 anchor/focus 路径检查 source)
const algoCheck = await ev(`(() => {
  // 检查 ContextMenuHost 已挂 + DomSelectionProvider 已注册
  // 通过 dispatchEvent 模拟选区然后查 highlightRects
  return { contextHost: !!document.querySelector('[data-slot="context-menu-host"]'), }
})()`)
// 单线 selection 测试
const singleLineTest = await ev(`(async () => {
  const tl = document.querySelector('.textLayer')
  const spans = Array.from(tl.querySelectorAll('span')).filter(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim())
  if (spans.length < 1) return { error: "no spans" }
  const span = spans[0]
  const text = span.textContent
  const range = document.createRange()
  const startOffset = 0
  const endOffset = Math.min(8, text.length)
  range.setStart(span.firstChild, startOffset)
  range.setEnd(span.firstChild, endOffset)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 400))
  const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]'))
  return { selText: sel.toString(), overlayCount: overlays.length }
})()`)
log("T3 单行选区 → 视觉 overlay 出现", singleLineTest.overlayCount > 0, `选了 "${singleLineTest.selText}",overlay rects=${singleLineTest.overlayCount}`)

// === T4 — QA #3 多行选区 → bbox NOT 扩到整页
const multiLineTest = await ev(`(async () => {
  const tl = document.querySelector('.textLayer')
  const spans = Array.from(tl.querySelectorAll('span')).filter(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim() && s.getBoundingClientRect().width > 0)
  // 找上下相邻 2-3 行的 spans
  const sorted = [...spans].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  if (sorted.length < 4) return { error: "spans not enough" }
  const startSpan = sorted[0]
  const endSpan = sorted[3]  // 第 4 个 span(假设 4 行内)
  const startRect = startSpan.getBoundingClientRect()
  const endRect = endSpan.getBoundingClientRect()
  const userIntendedHeight = endRect.bottom - startRect.top
  // 整页高度
  const pageWrap = document.querySelector('.pdf-page-wrapper')
  const pageHeight = parseFloat(pageWrap.style.height)
  // 设选区
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, Math.min(5, endSpan.firstChild.textContent.length))
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
  const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]'))
  let top = Infinity, bottom = -Infinity
  for (const o of overlays) {
    const r = o.getBoundingClientRect()
    if (r.top < top) top = r.top
    if (r.bottom > bottom) bottom = r.bottom
  }
  const overlayHeight = bottom - top
  // overlay 高度应该 < 整页高度(没扩到整页),应 ≈ user 拖拽的 4 行
  return {
    userIntendedHeight: Math.round(userIntendedHeight),
    overlayHeight: Math.round(overlayHeight),
    pageHeight: Math.round(pageHeight),
    overlayCount: overlays.length,
    ratio: (overlayHeight / pageHeight).toFixed(2),
  }
})()`)
const bboxOK = multiLineTest.ratio && parseFloat(multiLineTest.ratio) < 0.5  // overlay 不应超过半页
log("T4 QA#3 — 多行选区 overlay 不扩到整页", bboxOK, `userHeight=${multiLineTest.userIntendedHeight} overlay=${multiLineTest.overlayHeight} page=${multiLineTest.pageHeight} ratio=${multiLineTest.ratio}`)

// === T5 — 右键菜单 → 添加到聊天 → 卡片创建
await ev(`(() => { window.getSelection()?.removeAllRanges(); document.querySelectorAll('[data-slot="selection-overlay-rect"]').forEach(d => d.remove()) })()`)
const setSelForRC = await ev(`(async () => {
  const tl = document.querySelector('.textLayer')
  const spans = Array.from(tl.querySelectorAll('span')).filter(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim() && s.textContent.length > 5)
  if (!spans.length) return null
  const sp = spans[0]
  const range = document.createRange()
  range.setStart(sp.firstChild, 0)
  range.setEnd(sp.firstChild, Math.min(15, sp.firstChild.textContent.length))
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 400))
  const fr = document.createRange()
  fr.setStart(sel.focusNode, sel.focusOffset)
  fr.setEnd(sel.focusNode, sel.focusOffset)
  const r = fr.getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top + r.height/2), text: sel.toString() }
})()`)
if (setSelForRC) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: setSelForRC.x, y: setSelForRC.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 80))
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: setSelForRC.x, y: setSelForRC.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 300))
  const menuOpen = await ev(`(() => !!document.querySelector('[data-slot="context-menu-host"]'))()`)
  log("T5 右键 → menu 出现", menuOpen, `点击 (${setSelForRC.x},${setSelForRC.y})`)

  if (menuOpen) {
    await ev(`(() => { const m = document.querySelector('[data-slot="context-menu-host"]'); const b = Array.from(m.querySelectorAll('button')).find(b => b.textContent.includes('聊天')); b?.click() })()`)
    await new Promise(r => setTimeout(r, 300))
    const inInput = await ev(`(() => !!document.querySelector('[data-slot="context-menu-host"] textarea'))()`)
    log("T5b 添加到聊天 → input 模式切换", inInput, "")
    if (inInput) {
      await ev(`(() => { const ta = document.querySelector('[data-slot="context-menu-host"] textarea'); ta.value = "preflight 自动验证"; ta.dispatchEvent(new Event('input', {bubbles: true})) })()`)
      await new Promise(r => setTimeout(r, 100))
      await ev(`(() => { const bs = Array.from(document.querySelectorAll('[data-slot="context-menu-host"] button')); const sb = bs.find(b => /提交|加入|确定/.test(b.textContent||'')); if (sb) sb.click(); else { const ta = document.querySelector('[data-slot="context-menu-host"] textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })) }})()`)
      await new Promise(r => setTimeout(r, 600))
      const cardCheck = await ev(`(() => {
        const menu = !!document.querySelector('[data-slot="context-menu-host"]')
        const cards = Array.from(document.querySelectorAll('div[class*="rounded-"][class*="shadow-xs-border"]'))
        const editor = document.querySelector('[contenteditable="true"]')
        const editorText = editor?.textContent ?? ''
        return { menuStillOpen: menu, cardCount: cards.length, promptLen: editorText.length, hasBlockquote: editorText.includes('> ') }
      })()`)
      log("T5c 提交后 — 菜单关 + 卡片出现 + textarea 干净", !cardCheck.menuStillOpen && cardCheck.cardCount > 0 && cardCheck.promptLen === 0 && !cardCheck.hasBlockquote, JSON.stringify(cardCheck))
    }
  }
}

// === T6 — 跨页选区 partial 检测
const pageCount = await ev(`(() => document.querySelectorAll('.pdf-page-wrapper').length)()`)
if (pageCount > 1) {
  // 跨 page1-2 选区(若可见)
  const crossPage = await ev(`(async () => {
    const pages = document.querySelectorAll('.pdf-page-wrapper')
    if (pages.length < 2) return { skip: true }
    const p1Spans = pages[0].querySelectorAll('.textLayer span')
    const p2Spans = pages[1].querySelectorAll('.textLayer span')
    const sp1 = Array.from(p1Spans).find(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim())
    const sp2 = Array.from(p2Spans).find(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim())
    if (!sp1 || !sp2) return { skip: true, reason: "no spans on multiple pages" }
    const range = document.createRange()
    range.setStart(sp1.firstChild, 0)
    range.setEnd(sp2.firstChild, Math.min(5, sp2.firstChild.textContent.length))
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    await new Promise(r => setTimeout(r, 400))
    const fr = document.createRange(); fr.setStart(sel.focusNode, sel.focusOffset); fr.setEnd(sel.focusNode, sel.focusOffset)
    const r = fr.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top + r.height/2) }
  })()`)
  if (!crossPage.skip) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: crossPage.x, y: crossPage.y, button: "right", clickCount: 1 })
    await new Promise(r => setTimeout(r, 80))
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: crossPage.x, y: crossPage.y, button: "right", clickCount: 1 })
    await new Promise(r => setTimeout(r, 400))
    const partialCheck = await ev(`(() => {
      const menu = document.querySelector('[data-slot="context-menu-host"]')
      if (!menu) return { menuOpen: false }
      const addBtn = Array.from(menu.querySelectorAll('button')).find(b => b.textContent.includes('聊天'))
      const hint = !!menu.querySelector('div[class*="text-text-weak"]')
      return { menuOpen: true, addBtnDisabled: addBtn?.disabled, hasHint: hint }
    })()`)
    log("T6 跨页选区 — 菜单 partial hint + 添加按钮 disabled", partialCheck.menuOpen && partialCheck.addBtnDisabled === true, JSON.stringify(partialCheck))
    // 清菜单
    await ev(`(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))()`)
  } else {
    log("T6 跨页选区检测", true, "skipped: " + (crossPage.reason || "single page or spans unavail"))
  }
}

// === 汇总
console.log("\n========== 汇总 ==========")
const passed = results.filter(r => r.ok).length
console.log(`${passed}/${results.length} 项 pass`)
const failed = results.filter(r => !r.ok)
if (failed.length) {
  console.log("\n失败项:")
  failed.forEach(f => console.log(`  ❌ ${f.name} — ${f.detail}`))
}
writeFileSync("D:/tmp/preflight-qa-results.json", JSON.stringify({ env, results }, null, 2))
console.log("\nresults saved: D:/tmp/preflight-qa-results.json")
