// 切到 docx tab
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

const result = await ev(`(async () => {
  // 列出所有 tabs
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  const tabsInfo = tabs.map(t => ({ text: (t.textContent||'').trim().slice(0, 30), active: t.getAttribute('aria-selected') === 'true' }))
  // 找 .docx tab(不是 .pptx / .xlsx)
  const docxTab = tabs.find(t => /\\.docx/.test(t.textContent||''))
  if (!docxTab) return { tabsInfo, error: 'no docx tab' }
  docxTab.click()
  await new Promise(r => setTimeout(r, 3000))
  // 等 textLayer
  for (let i = 0; i < 30; i++) {
    if (document.querySelector('.textLayer')) break
    await new Promise(r => setTimeout(r, 500))
  }
  return {
    activatedTab: (docxTab.textContent||'').trim().slice(0, 50),
    pdfViewer: !!document.querySelector('[data-slot="pdf-viewer"]'),
    filePath: document.querySelector('[data-slot="pdf-viewer"]')?.dataset.filePath,
    textLayer: !!document.querySelector('.textLayer'),
    pageWraps: document.querySelectorAll('.pdf-page-wrapper').length,
  }
})()`)
console.log(JSON.stringify(result, null, 2))
