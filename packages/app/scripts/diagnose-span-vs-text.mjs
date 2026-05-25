// span.getBoundingClientRect vs 实际文字 paint 范围对比
const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws)
    let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("timeout")) }, 10000)
    w.addEventListener("open", () => w.send(JSON.stringify({ id, method, params })))
    w.addEventListener("message", e => {
      clearTimeout(t)
      const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
      if (m.id === id) { try { w.close() } catch {}; if (m.error) rej(new Error(m.error.message)); else res(m.result) }
    })
    w.addEventListener("error", rej)
  })
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

const r = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span"))
  const targets = ["私有化定制", "不确定风险", "都可审计"]
  const result = []
  for (const tgt of targets) {
    const span = spans.find(s => (s.textContent || "").includes(tgt) && s.getBoundingClientRect().width > 0)
    if (!span) { result.push({ tgt, error: "no span" }); continue }
    const r = span.getBoundingClientRect()
    const cs = getComputedStyle(span)
    // Range over text node 看真实绘制范围
    const range = document.createRange()
    if (span.firstChild) {
      range.selectNodeContents(span)
      const rangeRects = Array.from(range.getClientRects()).filter(r => r.width > 0)
      const rangeRight = rangeRects.length ? Math.max(...rangeRects.map(r => r.right)) : null
      const rangeLeft = rangeRects.length ? Math.min(...rangeRects.map(r => r.left)) : null
      result.push({
        tgt,
        text: span.textContent,
        spanRect: { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
        rangeRect: { x: rangeLeft != null ? Math.round(rangeLeft) : null, right: rangeRight != null ? Math.round(rangeRight) : null, count: rangeRects.length },
        style: {
          transform: span.style.transform,
          width: span.style.width,
          fontSize: span.style.fontSize,
          letterSpacing: span.style.letterSpacing,
        },
        cs: {
          transform: cs.transform,
          width: cs.width,
          overflow: cs.overflow,
        },
        scrollWidth: span.scrollWidth,
        clientWidth: span.clientWidth,
        offsetWidth: span.offsetWidth,
      })
    }
  }
  return JSON.stringify(result, null, 2)
})()`)

console.log(r)
