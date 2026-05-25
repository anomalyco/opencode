// FORK: 诊断"正掌握"为啥底色比左右浅
// 1. 设 selection 包含这段
// 2. dump 所有 spans 含"正掌握"的:y / x / w / h / 跟左右邻接 span 的 y 差
// 3. dump production overlay 的 rects(看是否有 overlap 导致颜色不均)
// [feat: office-选中加聊天] 2026-05-25

const CDP = "http://localhost:9222"
const pages = await (await fetch(`${CDP}/json`)).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))

function send(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const w = new WebSocket(ws)
    let id = 1
    const t = setTimeout(() => { try { w.close() } catch {}; rej(new Error("ws timeout")) }, 10000)
    w.addEventListener("open", () => w.send(JSON.stringify({ id, method, params })))
    w.addEventListener("message", e => {
      clearTimeout(t)
      const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
      if (m.id === id) { try { w.close() } catch {}; if (m.error) rej(new Error(m.error.message)); else res(m.result) }
    })
    w.addEventListener("error", rej)
  })
}
const ws = dpage.webSocketDebuggerUrl
async function ev(expr) {
  const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

// 选区包含"模型供应商，让开发者真正掌握" 这一行
console.log("Setting selection covering 模型供应商 line...")
await ev(`(async () => {
  const tl = document.querySelector(".textLayer")
  const spans = Array.from(tl.querySelectorAll("span")).filter(s => {
    if (!s.textContent || !s.textContent.trim()) return false
    return s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE
  })
  // 找选区起点终点 — 段落 1 完整覆盖到"主动权"为止
  const startSpan = spans.find(s => s.textContent.includes("作为"))
  const endSpan = spans.find(s => s.textContent.includes("主动权"))
  if (!startSpan || !endSpan) throw new Error("can't find anchor spans")
  const range = document.createRange()
  range.setStart(startSpan.firstChild, 0)
  range.setEnd(endSpan.firstChild, endSpan.firstChild.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await new Promise(r => setTimeout(r, 400))
})()`)

// dump spans 含"正掌握"的位置 + 邻接 spans
const dump = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const allSpans = Array.from(tl.querySelectorAll("span"))
  // 找含"正掌握"的 spans
  const targetSpans = allSpans.filter(s => /正|掌|握/.test(s.textContent || ""))
  const targets = targetSpans.map(s => {
    const r = s.getBoundingClientRect()
    return { text: s.textContent, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cy: Math.round(r.top + r.height / 2) }
  })

  // 找含"正掌握"完整文本的 span(精确锚定)
  const exactSpan = targetSpans.find(s => /正.{0,3}掌.{0,3}握|让开发者真正掌握/.test(s.textContent || ""))
  const lineY = exactSpan ? Math.round(exactSpan.getBoundingClientRect().top + exactSpan.getBoundingClientRect().height / 2) : null
  if (lineY === null) {
    return JSON.stringify({
      error: "no exact target",
      allTargets: targets,
    })
  }
  const lineSpans = allSpans.filter(s => {
    const r = s.getBoundingClientRect()
    const cy = Math.round(r.top + r.height / 2)
    return Math.abs(cy - lineY) <= 10 && s.textContent && r.width > 0
  }).map(s => {
    const r = s.getBoundingClientRect()
    return { text: s.textContent, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cy: Math.round(r.top + r.height / 2) }
  })

  // production overlay rects
  const overlays = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]')).map(d => ({
    x: Math.round(parseFloat(d.style.left)),
    y: Math.round(parseFloat(d.style.top)),
    w: Math.round(parseFloat(d.style.width)),
    h: Math.round(parseFloat(d.style.height)),
  }))

  return JSON.stringify({
    targetSpans: targets,
    lineSpansAt_cy: { cy: lineY, count: lineSpans.length, spans: lineSpans },
    overlays,
  })
})()`)

const data = JSON.parse(dump)
console.log("RAW dump:", JSON.stringify(data).slice(0, 500))
if (data.error) { console.log("Error:", data); process.exit(0) }
console.log("\n=== 含'正掌握'字的 spans ===")
for (const t of data.targetSpans) {
  console.log(`  ${JSON.stringify(t.text)}  x=${t.x} y=${t.y} cy=${t.cy} w=${t.w} h=${t.h}`)
}
console.log(`\n=== 同行 (cy=${data.lineSpansAt_cy.cy}) 所有 spans ===`)
for (const s of data.lineSpansAt_cy.spans) {
  console.log(`  ${JSON.stringify(s.text.slice(0, 30))}  x=${s.x} cy=${s.cy} w=${s.w} h=${s.h}`)
}
console.log(`\n=== Production overlay rects ===`)
for (const r of data.overlays) {
  console.log(`  x=${r.x} y=${r.y} w=${r.w} h=${r.h}  (right=${r.x + r.w})`)
}
