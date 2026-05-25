// 跑 4 格式 (docx/pptx/xlsx/pdf) + chat 选区回归 + 跨页(scroll 后)
const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws); let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 30000)
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

const allResults = []

async function activateTab(ext, name) {
  const r = await ev(`(async () => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    const t = tabs.find(tb => new RegExp("\\\\." + ${JSON.stringify(ext)} + "$").test(tb.textContent||''))
    if (!t) return { found: false }
    t.click()
    await new Promise(r => setTimeout(r, 2500))
    for (let i = 0; i < 30; i++) { if (document.querySelector('.textLayer')) break; await new Promise(r => setTimeout(r, 500)) }
    return { found: true, label: (t.textContent||'').trim().slice(0, 40), filePath: document.querySelector('[data-slot="pdf-viewer"]')?.dataset.filePath, pageWraps: document.querySelectorAll('.pdf-page-wrapper').length }
  })()`)
  return r
}

async function testFormat(ext) {
  const r = await activateTab(ext)
  if (!r.found) return { format: ext, skip: "no tab" }
  console.log(`\n--- ${ext} (${r.label}) | ${r.pageWraps} pages ---`)
  // 选区 + 右键 + 提交 + 验卡
  const test = await ev(`(async () => {
    // 等 textLayer + 清前一轮卡片(保留干净起点)
    for (let i = 0; i < 10; i++) { if (document.querySelector('.textLayer span')) break; await new Promise(r => setTimeout(r, 500)) }
    const tl = document.querySelector('.textLayer')
    if (!tl) return { error: "no textLayer" }
    const spans = Array.from(tl.querySelectorAll('span')).filter(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim().length > 3)
    if (spans.length === 0) return { error: "no selectable spans" }
    const sp = spans[0]
    const range = document.createRange()
    range.setStart(sp.firstChild, 0)
    range.setEnd(sp.firstChild, Math.min(10, sp.firstChild.textContent.length))
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    await new Promise(r => setTimeout(r, 400))
    const text = sel.toString()
    const fr = document.createRange(); fr.setStart(sel.focusNode, sel.focusOffset); fr.setEnd(sel.focusNode, sel.focusOffset)
    const fRect = fr.getBoundingClientRect()
    return { selText: text, x: Math.round(fRect.left), y: Math.round(fRect.top + fRect.height/2), pageWraps: document.querySelectorAll('.pdf-page-wrapper').length, totalScaleFactor: getComputedStyle(document.querySelector('.pdf-page-wrapper')).getPropertyValue('--total-scale-factor').trim() }
  })()`)
  if (test.error) return { format: ext, skip: test.error }
  // right-click
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: test.x, y: test.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 80))
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: test.x, y: test.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 300))
  const menuOpen = await ev(`(() => !!document.querySelector('[data-slot="context-menu-host"]'))()`)
  if (!menuOpen) return { format: ext, ...test, menuOpen: false }
  // 添加 + 提交
  await ev(`(() => { const m = document.querySelector('[data-slot="context-menu-host"]'); const b = Array.from(m.querySelectorAll('button')).find(b => b.textContent.includes('聊天')); b?.click() })()`)
  await new Promise(r => setTimeout(r, 300))
  await ev(`(() => { const ta = document.querySelector('[data-slot="context-menu-host"] textarea'); if (!ta) return; ta.value = "preflight 全格式 ${ext}"; ta.dispatchEvent(new Event('input', {bubbles: true})) })()`)
  await new Promise(r => setTimeout(r, 100))
  await ev(`(() => { const bs = Array.from(document.querySelectorAll('[data-slot="context-menu-host"] button')); const sb = bs.find(b => /提交|加入|确定/.test(b.textContent||'')); if (sb) sb.click(); else { const ta = document.querySelector('[data-slot="context-menu-host"] textarea'); ta?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })) }})()`)
  await new Promise(r => setTimeout(r, 500))
  const final = await ev(`(() => {
    const m = !!document.querySelector('[data-slot="context-menu-host"]')
    const cards = Array.from(document.querySelectorAll('div[class*="rounded-"][class*="shadow-xs-border"]'))
    const editor = document.querySelector('[contenteditable="true"]')
    return { menuStillOpen: m, cardCount: cards.length, promptLen: editor?.textContent?.length || 0 }
  })()`)
  return { format: ext, ...test, menuOpen: true, ...final }
}

console.log("===== 4 格式自动测试 =====")
for (const ext of ["docx", "pptx", "xlsx", "pdf"]) {
  const r = await testFormat(ext)
  allResults.push(r)
  console.log(JSON.stringify(r, null, 2))
  // 清选区给下一格式起点干净
  await ev(`(() => { window.getSelection()?.removeAllRanges() })()`)
  await new Promise(r => setTimeout(r, 500))
}

// === 跨页测试:在 pptx 上滚到第 2 页 + 跨页选
console.log("\n===== 跨页测试(pptx,scroll 后)=====")
await activateTab("pptx")
const crossPage = await ev(`(async () => {
  const wraps = Array.from(document.querySelectorAll('.pdf-page-wrapper'))
  if (wraps.length < 2) return { skip: "single page" }
  // 滚到 page 2 让 textLayer 加载
  const container = wraps[0].parentElement
  container.scrollTop = wraps[0].offsetHeight - 100
  await new Promise(r => setTimeout(r, 2500))
  const p1Spans = wraps[0].querySelectorAll('.textLayer span')
  const p2Spans = wraps[1].querySelectorAll('.textLayer span')
  const sp1 = Array.from(p1Spans).find(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim().length > 3)
  const sp2 = Array.from(p2Spans).find(s => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent.trim().length > 3)
  if (!sp1 || !sp2) return { skip: "no spans on multi pages", p1len: p1Spans.length, p2len: p2Spans.length }
  const range = document.createRange()
  range.setStart(sp1.firstChild, 0)
  range.setEnd(sp2.firstChild, Math.min(5, sp2.firstChild.textContent.length))
  const sel = window.getSelection()
  sel.removeAllRanges(); sel.addRange(range)
  await new Promise(r => setTimeout(r, 500))
  const fr = document.createRange(); fr.setStart(sel.focusNode, sel.focusOffset); fr.setEnd(sel.focusNode, sel.focusOffset)
  const r = fr.getBoundingClientRect()
  // 滚到 focus 可见
  fr.startContainer.parentElement.scrollIntoView({ block: 'center' })
  await new Promise(r => setTimeout(r, 800))
  const r2 = fr.getBoundingClientRect()
  return { x: Math.round(r2.left), y: Math.round(r2.top + r2.height/2), selText: sel.toString().slice(0, 50), selLen: sel.toString().length }
})()`)
if (!crossPage.skip) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: crossPage.x, y: crossPage.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 80))
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: crossPage.x, y: crossPage.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 400))
  const cp = await ev(`(() => {
    const m = document.querySelector('[data-slot="context-menu-host"]')
    if (!m) return { menuOpen: false }
    const addBtn = Array.from(m.querySelectorAll('button')).find(b => b.textContent.includes('聊天'))
    const hint = !!m.querySelector('div[class*="text-text-weak"]')
    return { menuOpen: true, addBtnDisabled: addBtn?.disabled, hasHint: hint }
  })()`)
  console.log("跨页测试结果:", JSON.stringify({ ...crossPage, ...cp }, null, 2))
  allResults.push({ format: "crossPage", ...crossPage, ...cp })
  await ev(`(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))()`)
} else {
  console.log("跨页测试 skipped:", crossPage)
}

// === chat 选区回归(没 sourcePath → 走老 blockquote 路径)
console.log("\n===== chat 选区回归测试 =====")
const chatTest = await ev(`(async () => {
  // 找 chat 消息(message-part-content)
  const msgs = document.querySelectorAll('[data-slot="session-turn-list"] [class*="message"], .message-part, [data-message-part]')
  if (msgs.length === 0) return { skip: "no chat msgs" }
  // 找含文字的 message
  let target = null
  for (const m of msgs) {
    const text = m.textContent
    if (text && text.length > 20) { target = m; break }
  }
  if (!target) return { skip: "no text msg" }
  const range = document.createRange()
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  while (walker.nextNode()) { if (walker.currentNode.textContent.trim()) textNodes.push(walker.currentNode) }
  if (textNodes.length === 0) return { skip: "no text nodes" }
  range.setStart(textNodes[0], 0)
  range.setEnd(textNodes[0], Math.min(15, textNodes[0].textContent.length))
  const sel = window.getSelection()
  sel.removeAllRanges(); sel.addRange(range)
  await new Promise(r => setTimeout(r, 400))
  const fr = document.createRange(); fr.setStart(sel.focusNode, sel.focusOffset); fr.setEnd(sel.focusNode, sel.focusOffset)
  const r = fr.getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top + r.height/2), text: sel.toString().slice(0, 30) }
})()`)
if (!chatTest.skip) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: chatTest.x, y: chatTest.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 80))
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: chatTest.x, y: chatTest.y, button: "right", clickCount: 1 })
  await new Promise(r => setTimeout(r, 300))
  const menuOpen = await ev(`(() => !!document.querySelector('[data-slot="context-menu-host"]'))()`)
  if (menuOpen) {
    await ev(`(() => { const m = document.querySelector('[data-slot="context-menu-host"]'); const b = Array.from(m.querySelectorAll('button')).find(b => b.textContent.includes('聊天')); b?.click() })()`)
    await new Promise(r => setTimeout(r, 300))
    await ev(`(() => { const ta = document.querySelector('[data-slot="context-menu-host"] textarea'); if (ta) { ta.value = ""; ta.dispatchEvent(new Event('input', {bubbles: true})) } })()`)
    await ev(`(() => { const bs = Array.from(document.querySelectorAll('[data-slot="context-menu-host"] button')); const sb = bs.find(b => /提交|加入|确定/.test(b.textContent||'')); sb?.click() })()`)
    await new Promise(r => setTimeout(r, 500))
    const final = await ev(`(() => {
      const editor = document.querySelector('[contenteditable="true"]')
      const text = editor?.textContent || ''
      const cards = Array.from(document.querySelectorAll('div[class*="rounded-"][class*="shadow-xs-border"]'))
      return { promptText: text.slice(0, 60), promptHasBlockquote: text.includes('> '), promptLen: text.length, cardCount: cards.length }
    })()`)
    console.log("chat 选区结果:", JSON.stringify(final, null, 2))
    allResults.push({ format: "chat", ...chatTest, ...final, expectBlockquote: true })
  } else {
    console.log("chat 选区菜单未弹:", chatTest)
  }
} else {
  console.log("chat 选区 skipped:", chatTest)
}

console.log("\n===== 汇总 =====")
for (const r of allResults) {
  const fmt = r.format.padEnd(10)
  if (r.skip) console.log(`⚪ ${fmt} — skip: ${r.skip}`)
  else if (r.error) console.log(`❌ ${fmt} — ${r.error}`)
  else {
    const cardOK = r.cardCount > 0 || r.format === 'crossPage'
    const cleanText = !r.promptHasBlockquote || r.format === 'chat'
    const status = (r.menuOpen !== false && (cardOK || r.addBtnDisabled === true || r.format === 'chat')) ? '✅' : '⚠️'
    console.log(`${status} ${fmt} menu=${r.menuOpen} cards=${r.cardCount} scale=${r.totalScaleFactor} ${r.format === 'chat' ? `blockquote=${r.promptHasBlockquote}` : ''} ${r.format === 'crossPage' ? `disabled=${r.addBtnDisabled} hint=${r.hasHint}` : ''}`)
  }
}
