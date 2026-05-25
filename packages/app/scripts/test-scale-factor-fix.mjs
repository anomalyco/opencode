// 测试 --total-scale-factor 是否是 textLayer 宽度错的元凶
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

// Before: 看现有 wrap / textLayer 的 CSS 变量值 + span 计算字体
const before = await ev(`(() => {
  const wrap = document.querySelector(".pdf-page-wrapper")
  const tl = document.querySelector(".textLayer")
  const targetSpan = Array.from(tl.querySelectorAll("span")).find(s => (s.textContent||"").includes("私有化定制") && s.getBoundingClientRect().width > 0)
  const csWrap = getComputedStyle(wrap)
  const csTl = getComputedStyle(tl)
  const csSpan = getComputedStyle(targetSpan)
  const r = targetSpan.getBoundingClientRect()
  return JSON.stringify({
    wrapTotalScale: csWrap.getPropertyValue("--total-scale-factor") || "(unset)",
    tlTotalScale: csTl.getPropertyValue("--total-scale-factor") || "(unset)",
    spanFontSize: csSpan.fontSize,
    spanWidth: csSpan.width,
    spanRect: { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
    spanInlineFontHeight: targetSpan.style.getPropertyValue("--font-height") || "(unset)",
    spanInlineScaleX: targetSpan.style.getPropertyValue("--scale-x") || "(unset)",
  }, null, 2)
})()`)
console.log("=== BEFORE setting --total-scale-factor ===")
console.log(before)

// 拿 viewport scale — 从 canvas style.width / page.naturalWidth 反推
// 我们 resolveScale 输出 0.6 ~ 1.5,通常 1.0 附近
// 试 1.0 看效果
await ev(`(() => {
  document.querySelectorAll(".pdf-page-wrapper").forEach(w => {
    w.style.setProperty("--total-scale-factor", "1.0")
  })
  return "set 1.0"
})()`)
const after1 = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const targetSpan = Array.from(tl.querySelectorAll("span")).find(s => (s.textContent||"").includes("私有化定制") && s.getBoundingClientRect().width > 0)
  const csSpan = getComputedStyle(targetSpan)
  const r = targetSpan.getBoundingClientRect()
  return JSON.stringify({ spanFontSize: csSpan.fontSize, spanRect: { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) } })
})()`)
console.log("\n=== AFTER --total-scale-factor=1.0 ===")
console.log(after1)

// 试 1.5
await ev(`(() => { document.querySelectorAll(".pdf-page-wrapper").forEach(w => w.style.setProperty("--total-scale-factor", "1.5")); })()`)
const after15 = await ev(`(() => {
  const tl = document.querySelector(".textLayer")
  const targetSpan = Array.from(tl.querySelectorAll("span")).find(s => (s.textContent||"").includes("私有化定制") && s.getBoundingClientRect().width > 0)
  const csSpan = getComputedStyle(targetSpan)
  const r = targetSpan.getBoundingClientRect()
  return JSON.stringify({ spanFontSize: csSpan.fontSize, spanRect: { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) } })
})()`)
console.log("\n=== AFTER --total-scale-factor=1.5 ===")
console.log(after15)
