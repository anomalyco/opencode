// FORK: 真桌面 DeskFox CDP 选区行为验证 + 中间态 instrumentation
// [feat: office-选中加聊天] 2026-05-25

const CDP_HTTP = "http://localhost:9222"

async function listPages() {
  const res = await fetch(`${CDP_HTTP}/json`)
  return res.json()
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.addEventListener("open", () => resolve())
      this.ws.addEventListener("error", reject)
      this.ws.addEventListener("message", (e) => {
        const msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message))
          else resolve(msg.result)
        }
      })
    })
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP ${method} timeout`))
        }
      }, 10000)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.text}`)
    return r.result.value
  }
  close() {
    try { this.ws.close() } catch {}
  }
}

async function dispatchMouse(cdp, type, x, y) {
  await cdp.call("Input.dispatchMouseEvent", {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: type === "mousePressed" ? 1 : 0,
  })
}

async function main() {
  const pages = await listPages()
  const deskfoxPage = pages.find(
    (p) => p.type === "page" && p.url.startsWith("http://tauri.localhost"),
  )
  if (!deskfoxPage) {
    console.error("DeskFox page not found")
    process.exit(1)
  }

  const cdp = new CdpClient(deskfoxPage.webSocketDebuggerUrl)
  await cdp.connect()
  console.log(`Connected: ${deskfoxPage.title}`)

  // 找视口内可见的 textLayer + 同一行附近的两个 spans
  const targets = await cdp.eval(`(() => {
    const allTl = Array.from(document.querySelectorAll(".textLayer"))
    const visibleTl = allTl.find(tl => {
      const r = tl.getBoundingClientRect()
      return r.bottom > 0 && r.top < window.innerHeight && r.width > 0
    })
    if (!visibleTl) return null
    const allSpans = Array.from(visibleTl.querySelectorAll("span"))
    // 过滤可见 + 有文字
    const visSpans = allSpans.filter(s => {
      const t = s.textContent
      if (!t || !t.trim()) return false
      const r = s.getBoundingClientRect()
      return r.bottom > 100 && r.top < window.innerHeight - 100 && r.left > 0 && r.right < window.innerWidth && r.width > 5
    })
    if (visSpans.length < 10) return null
    // 跨大段拖选 — 模拟 user 截图实测 scenario(从上段拖到下段几百 px)
    const startIdx = Math.max(0, Math.floor(visSpans.length * 0.2))
    const endIdx = Math.min(visSpans.length - 1, Math.floor(visSpans.length * 0.5))
    const startSpan = visSpans[startIdx]
    const endSpan = visSpans[endIdx]
    const startRect = startSpan.getBoundingClientRect()
    const endRect = endSpan.getBoundingClientRect()
    let expectedText = ""
    let cap = false
    for (const s of allSpans) {
      if (s === startSpan) cap = true
      if (cap) expectedText += s.textContent || ""
      if (s === endSpan) { cap = false; break }
    }
    return {
      startX: startRect.left + 2,
      startY: startRect.top + startRect.height / 2,
      endX: endRect.right - 2,
      endY: endRect.top + endRect.height / 2,
      startSpanText: startSpan.textContent,
      endSpanText: endSpan.textContent,
      expectedText,
      expectedLength: expectedText.length,
      visibleSpansCount: visSpans.length,
      tlFullTextLength: visibleTl.textContent.length,
      viewportSize: { w: window.innerWidth, h: window.innerHeight },
      dragDy: endRect.top - startRect.top,
    }
  })()`)

  if (!targets) {
    console.error("找不到可测 textLayer / spans")
    cdp.close()
    process.exit(1)
  }

  console.log("\n=== Test setup ===")
  console.log(`  Viewport: ${targets.viewportSize.w}x${targets.viewportSize.h}`)
  console.log(`  Drag from (${targets.startX.toFixed(0)}, ${targets.startY.toFixed(0)}) [${JSON.stringify(targets.startSpanText.slice(0,30))}]`)
  console.log(`        to   (${targets.endX.toFixed(0)}, ${targets.endY.toFixed(0)}) [${JSON.stringify(targets.endSpanText.slice(0,30))}]`)
  console.log(`  Drag dy (px,跨行距离): ${targets.dragDy.toFixed(0)}`)
  console.log(`  Visible textLayer text length: ${targets.tlFullTextLength}, visible spans: ${targets.visibleSpansCount}`)
  console.log(`  Expected selection length: ${targets.expectedLength}`)
  console.log(`  Expected text: ${JSON.stringify(targets.expectedText.slice(0, 100))}`)

  await cdp.eval(`window.getSelection().removeAllRanges()`)

  await dispatchMouse(cdp, "mouseMoved", targets.startX, targets.startY)
  await dispatchMouse(cdp, "mousePressed", targets.startX, targets.startY)
  // 慢速 30 步拖拽,每步 30ms,模拟真实人手
  const steps = 30
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = targets.startX + (targets.endX - targets.startX) * t
    const y = targets.startY + (targets.endY - targets.startY) * t
    await dispatchMouse(cdp, "mouseMoved", x, y)
    await new Promise(r => setTimeout(r, 30))
  }
  await new Promise(r => setTimeout(r, 200))

  // 拖拽中读 — mouseUp 前
  const midState = await cdp.eval(`(() => {
    const sel = window.getSelection()
    const text = sel ? sel.toString() : ""
    // 看 selecting class 是否还在,endOfContent 位置是否被移动
    const tl = document.querySelector(".textLayer")
    const hasSelecting = tl ? tl.classList.contains("selecting") : null
    const eoc = tl ? tl.querySelector(":scope > .endOfContent, :scope .endOfContent") : null
    const eocStyle = eoc ? { width: eoc.style.width, height: eoc.style.height, userSelect: eoc.style.userSelect } : null
    const eocPosition = eoc && eoc.parentElement ? Array.from(eoc.parentElement.children).indexOf(eoc) : null
    return {
      midLength: text.length,
      midText: text.slice(0, 200),
      hasSelecting,
      eocStyle,
      eocPositionInParent: eocPosition,
    }
  })()`)

  await dispatchMouse(cdp, "mouseReleased", targets.endX, targets.endY)
  await new Promise(r => setTimeout(r, 200))

  const actual = await cdp.eval(`(() => {
    const sel = window.getSelection()
    const text = sel ? sel.toString() : ""
    return { text, length: text.length }
  })()`)

  console.log("\n=== Mid-drag (before mouseUp) ===")
  console.log(`  Selection length: ${midState.midLength}`)
  console.log(`  Selection text: ${JSON.stringify(midState.midText)}`)
  console.log(`  textLayer.selecting class: ${midState.hasSelecting}`)
  console.log(`  endOfContent inline style: ${JSON.stringify(midState.eocStyle)}`)
  console.log(`  endOfContent position index in parent: ${midState.eocPositionInParent}`)

  console.log("\n=== Final selection (after mouseUp) ===")
  console.log(`  Length: ${actual.length}`)
  console.log(`  Text: ${JSON.stringify(actual.text.slice(0, 300))}`)

  console.log("\n=== Verdict ===")
  const expectedRange = [Math.max(1, Math.floor(targets.expectedLength * 0.5)), Math.max(targets.expectedLength * 3, 30)]
  if (actual.length === 0) {
    console.log("  ❌ Selection 为空 — 拖选失败")
  } else if (actual.length > targets.tlFullTextLength * 0.7) {
    console.log(`  ❌ Selection ${actual.length} 接近 textLayer 全文 ${targets.tlFullTextLength} — bug 1 未修(选区越界)`)
  } else if (actual.length >= expectedRange[0] && actual.length <= expectedRange[1]) {
    console.log(`  ✅ Selection ${actual.length} 在合理范围(预期 ${targets.expectedLength})— TextLayerBuilder 有效`)
  } else if (actual.length > targets.expectedLength * 3) {
    console.log(`  ⚠ Selection ${actual.length} 是预期 ${targets.expectedLength} 的 ${(actual.length / targets.expectedLength).toFixed(1)} 倍 — CDP 合成事件可能未完整触发 selectionchange,真用户测试更准`)
  } else {
    console.log(`  ⚠ Selection ${actual.length} 偏离预期 ${targets.expectedLength}`)
  }

  cdp.close()
}

main().catch((e) => {
  console.error("Failed:", e)
  process.exit(1)
})
