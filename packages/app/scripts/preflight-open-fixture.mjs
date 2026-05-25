// 切到 D:\Downloads + 找一个 docx 打开 + 等 textLayer 就绪
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}

// 1. 切到 Downloads 目录 — URL 编码 D:\Downloads = base64("D:\\Downloads") with URL-safe (Y2gtY2hhcj0p)
// 直接 navigate
const dlBase64 = Buffer.from("D:\\Downloads").toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
console.log("Downloads base64:", dlBase64)
await send("Page.navigate", { url: `http://tauri.localhost/${dlBase64}/session` })
await new Promise(r => setTimeout(r, 3000))

// 2. 找 file tree 上的 docx
const result = await ev(`(async () => {
  // 等 file tree 加载
  for (let i = 0; i < 20; i++) {
    if (document.querySelector('[data-slot="file-tree"]') || document.querySelector('[role="tree"]')) break
    await new Promise(r => setTimeout(r, 300))
  }
  // 找 "1 Office文件" 文件夹
  const items = Array.from(document.querySelectorAll('*'))
  const folder = items.find(el => (el.textContent||'').trim() === '1 Office文件' && el.tagName !== 'SCRIPT')
  if (folder) {
    folder.click()
    await new Promise(r => setTimeout(r, 800))
  }
  // 找 docx
  const docxItems = Array.from(document.querySelectorAll('*')).filter(el => /文档\d?\.docx/.test((el.textContent||'').trim()) && !el.children.length)
  if (docxItems.length > 0) {
    docxItems[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise(r => setTimeout(r, 5000))
  }
  return {
    url: location.href,
    pdfViewer: !!document.querySelector('[data-slot="pdf-viewer"]'),
    textLayer: !!document.querySelector('.textLayer'),
    pageWraps: document.querySelectorAll('.pdf-page-wrapper').length,
    docxFound: docxItems.map(e => e.textContent.trim()).slice(0, 3),
  }
})()`)
console.log(JSON.stringify(result, null, 2))
