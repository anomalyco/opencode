// 切到 Downloads session 含 docx 的那一条
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

const dlBase64 = Buffer.from("D:\\Downloads").toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
await send("Page.navigate", { url: `http://tauri.localhost/${dlBase64}/session/ses_1a2320df9ffeT47S8gZ3rWC7Pv` })
await new Promise(r => setTimeout(r, 5000))

const result = await ev(`(async () => {
  for (let i = 0; i < 30; i++) {
    if (document.querySelector('[data-slot="pdf-viewer"]')) break
    await new Promise(r => setTimeout(r, 500))
  }
  return {
    url: location.href,
    pdfViewer: !!document.querySelector('[data-slot="pdf-viewer"]'),
    pdfFilePath: document.querySelector('[data-slot="pdf-viewer"]')?.dataset.filePath,
    textLayer: !!document.querySelector('.textLayer'),
    pageWraps: document.querySelectorAll('.pdf-page-wrapper').length,
    activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.slice(0, 60),
  }
})()`)
console.log(JSON.stringify(result, null, 2))
