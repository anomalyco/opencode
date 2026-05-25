import { writeFileSync } from "node:fs"
const pages = await (await fetch("http://localhost:9222/json")).json()
const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
const ws = dpage.webSocketDebuggerUrl
function send(method, params={}) { return new Promise((res, rej) => { const w = new WebSocket(ws); w.addEventListener("open", () => w.send(JSON.stringify({ id:1, method, params }))); w.addEventListener("message", e => { const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)); if (m.id===1) { w.close(); if (m.error) rej(new Error(m.error.message)); else res(m.result) } }); w.addEventListener("error", rej) }) }
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails)); return r.result.value }

await ev(`(() => {
  document.querySelectorAll('[data-slot="selection-overlay-rect"]').forEach(d => { d.style.outline = ""; d.style.outlineOffset = "" })
  document.querySelectorAll('[data-debug-marker]').forEach(d => d.remove())
  for (const x of [974, 1481, 1517]) {
    const m = document.createElement("div")
    m.setAttribute("data-debug-marker", "")
    m.style.cssText = "position:fixed; left:" + x + "px; top:600px; width:2px; height:130px; background:red; z-index:100; pointer-events:none"
    document.body.appendChild(m)
  }
  return "ok"
})()`)
const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 900, y: 600, width: 700, height: 130, scale: 3 } })
writeFileSync("D:/tmp/deskfox-x-markers.png", Buffer.from(r.data, "base64"))
console.log("Saved")
