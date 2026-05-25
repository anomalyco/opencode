// FORK: 真桌面 DeskFox CDP 选区行为验证 + 视觉 bbox 完整性校验
// 2026-05-25 user 反馈:DOM 线性 expected 不准 — 复杂 PDF box/表格内容 DOM 顺序 ≠ 视觉顺序,
// 必须按"视觉 bbox 内所有 spans"算 expected,才能 catch "视觉漏掉的字"。
// [feat: office-选中加聊天] 2026-05-25

const CDP_HTTP = "http://localhost:9222"

async function listPages() {
  const r = await fetch(`${CDP_HTTP}/json`)
  return r.json()
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
  }
  async connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.addEventListener("open", () => res())
      this.ws.addEventListener("error", rej)
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
    return new Promise((res, rej) => {
      const id = this.nextId++
      this.pending.set(id, { resolve: res, reject: rej })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error(`timeout`))
        }
      }, 10000)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.text}`)
    return r.result.value
  }
  close() { try { this.ws.close() } catch {} }
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
  const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
  if (!dpage) { console.error("DeskFox page not found"); process.exit(1) }

  const cdp = new CdpClient(dpage.webSocketDebuggerUrl)
  await cdp.connect()
  console.log(`Connected: ${dpage.title}`)

  // 找视口内可见的 textLayer + 选 startSpan/endSpan(20% / 50%)
  // **关键改进**:expected 同时算两种 — DOM 线性 vs 视觉 bbox 内 spans,对比看差距 = 漏掉的内容
  const targets = await cdp.eval(`(() => {
    const allTl = Array.from(document.querySelectorAll(".textLayer"))
    const visibleTl = allTl.find(tl => {
      const r = tl.getBoundingClientRect()
      return r.bottom > 0 && r.top < window.innerHeight && r.width > 0
    })
    if (!visibleTl) return null
    const allSpans = Array.from(visibleTl.querySelectorAll("span"))
    const visSpans = allSpans.filter(s => {
      const t = s.textContent
      if (!t || !t.trim()) return false
      const r = s.getBoundingClientRect()
      return r.bottom > 100 && r.top < window.innerHeight - 100 && r.left > 0 && r.right < window.innerWidth && r.width > 5
    })
    if (visSpans.length < 10) return null
    const startIdx = Math.max(0, Math.floor(visSpans.length * 0.2))
    const endIdx = Math.min(visSpans.length - 1, Math.floor(visSpans.length * 0.5))
    const startSpan = visSpans[startIdx]
    const endSpan = visSpans[endIdx]
    const startRect = startSpan.getBoundingClientRect()
    const endRect = endSpan.getBoundingClientRect()

    // DOM 线性 expected(老算法)
    let domLinearExpected = ""
    let cap = false
    for (const s of allSpans) {
      if (s === startSpan) cap = true
      if (cap) domLinearExpected += s.textContent || ""
      if (s === endSpan) { cap = false; break }
    }

    // 视觉 bbox 内 expected(新算法,catch 漏掉的字 — 包含 whitespace spans 防"天窗")
    const bboxTop = Math.min(startRect.top, endRect.top)
    const bboxBottom = Math.max(startRect.bottom, endRect.bottom)
    const visualSpans = allSpans.filter(s => {
      const r = s.getBoundingClientRect()
      const cy = r.top + r.height / 2
      // 注:**不过滤 whitespace-only spans**,跟 production dom-provider.ts 一致
      return cy >= bboxTop && cy <= bboxBottom && s.textContent && r.width > 0 && r.height > 0
    })
    visualSpans.sort((a, b) => {
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      if (Math.abs(ra.top - rb.top) > 5) return ra.top - rb.top
      return ra.left - rb.left
    })
    const visualExpected = visualSpans.map(s => s.textContent || "").join("")

    // 视觉 bbox 内但 DOM 线性顺序外的 spans = pdf.js textLayer 顺序错位导致选区漏掉的内容
    const domSet = new Set()
    let cap2 = false
    for (const s of allSpans) {
      if (s === startSpan) cap2 = true
      if (cap2) domSet.add(s)
      if (s === endSpan) break
    }
    const missedSpans = visualSpans.filter(s => !domSet.has(s))
    const missedTexts = missedSpans.map(s => (s.textContent || "").trim()).filter(t => t.length > 0)

    return {
      startX: startRect.left + 2,
      startY: startRect.top + startRect.height / 2,
      endX: endRect.right - 2,
      endY: endRect.top + endRect.height / 2,
      startSpanText: startSpan.textContent,
      endSpanText: endSpan.textContent,
      domLinearExpected,
      domLinearExpectedLength: domLinearExpected.length,
      visualExpected,
      visualExpectedLength: visualExpected.length,
      missedCount: missedTexts.length,
      missedSample: missedTexts.slice(0, 12).map(t => t.slice(0, 40)),
      visibleSpansCount: visSpans.length,
      tlFullTextLength: visibleTl.textContent.length,
      viewportSize: { w: window.innerWidth, h: window.innerHeight },
      dragDy: endRect.top - startRect.top,
    }
  })()`)

  if (!targets) { console.error("找不到可测 textLayer / spans"); cdp.close(); process.exit(1) }

  console.log("\n=== Test setup ===")
  console.log(`  Viewport: ${targets.viewportSize.w}x${targets.viewportSize.h}`)
  console.log(`  Drag from (${targets.startX.toFixed(0)}, ${targets.startY.toFixed(0)}) [${JSON.stringify(targets.startSpanText.slice(0, 30))}]`)
  console.log(`        to   (${targets.endX.toFixed(0)}, ${targets.endY.toFixed(0)}) [${JSON.stringify(targets.endSpanText.slice(0, 30))}]`)
  console.log(`  Drag dy: ${targets.dragDy.toFixed(0)} px`)
  console.log(`  Visible textLayer text length: ${targets.tlFullTextLength}, visible spans: ${targets.visibleSpansCount}`)
  console.log(`  Expected (DOM 线性): ${targets.domLinearExpectedLength} 字`)
  console.log(`  Expected (视觉 bbox): ${targets.visualExpectedLength} 字`)
  console.log(`  💡 视觉 bbox 比 DOM 线性多 ${targets.missedCount} 个 span 漏掉,采样:`)
  for (const t of targets.missedSample) console.log(`     - ${JSON.stringify(t)}`)

  await cdp.eval(`window.getSelection().removeAllRanges()`)
  await dispatchMouse(cdp, "mouseMoved", targets.startX, targets.startY)
  await dispatchMouse(cdp, "mousePressed", targets.startX, targets.startY)
  const steps = 30
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = targets.startX + (targets.endX - targets.startX) * t
    const y = targets.startY + (targets.endY - targets.startY) * t
    await dispatchMouse(cdp, "mouseMoved", x, y)
    await new Promise(r => setTimeout(r, 30))
  }
  await new Promise(r => setTimeout(r, 200))
  await dispatchMouse(cdp, "mouseReleased", targets.endX, targets.endY)
  await new Promise(r => setTimeout(r, 200))

  // Native selection(浏览器原生,只测 textLayer 越界是否修)
  const native = await cdp.eval(`(() => {
    const sel = window.getSelection()
    const text = sel ? sel.toString() : ""
    return { text, length: text.length }
  })()`)

  // 视觉 overlay 实测(拖拽中应该已经渲染)
  const overlay = await cdp.eval(`(() => {
    // 找 data-slot="selection-overlay-rect" 或 z-40 + pointer-events-none + rgba(209,52,56) 背景
    let rects = Array.from(document.querySelectorAll('[data-slot="selection-overlay-rect"]'))
    if (rects.length === 0) {
      rects = Array.from(document.querySelectorAll('div.fixed.pointer-events-none.z-40')).filter(d => {
        return d.style.backgroundColor && d.style.backgroundColor.includes('209, 52, 56')
      })
    }
    return { count: rects.length }
  })()`)

  // 模拟 DomSelectionProvider.collectVisualSpansInBbox — 验"右键时 Provider 拿到什么"
  // 这一段代码必须跟 packages/app/src/utils/context-menu-host/dom-provider.ts 里的算法 1:1 一致
  const providerVisual = await cdp.eval(`(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const pdfViewer = document.querySelector('[data-slot="pdf-viewer"]')
    if (!pdfViewer) return null
    const nativeRects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
    if (nativeRects.length === 0) return null
    let bboxTop = Infinity, bboxBottom = -Infinity
    for (const r of nativeRects) {
      if (r.top < bboxTop) bboxTop = r.top
      if (r.bottom > bboxBottom) bboxBottom = r.bottom
    }
    if (!isFinite(bboxTop) || !isFinite(bboxBottom)) return null
    const allSpans = pdfViewer.querySelectorAll(".textLayer span")
    const hits = []
    allSpans.forEach(el => {
      const t = el.textContent
      if (!t) return  // truly empty(无 text node)才过滤 — whitespace span 保留防"天窗"
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const cy = r.top + r.height / 2
      if (cy < bboxTop || cy > bboxBottom) return
      hits.push({ el, rect: r, cy })
    })
    if (hits.length === 0) return null
    hits.sort((a, b) => {
      if (Math.abs(a.rect.top - b.rect.top) > 5) return a.rect.top - b.rect.top
      return a.rect.left - b.rect.left
    })
    let text = ""
    let prevTop = null
    for (const h of hits) {
      if (prevTop !== null && Math.abs(h.rect.top - prevTop) > 5) text += "\\n"
      text += h.el.textContent || ""
      prevTop = h.rect.top
    }
    return { text, length: text.length, rectsCount: hits.length }
  })()`)

  console.log("\n=== Native selection(浏览器原生)===")
  console.log(`  Length: ${native.length}`)
  console.log(`  Text: ${JSON.stringify(native.text.slice(0, 300))}`)

  console.log("\n=== 视觉 overlay(拖拽中应实时渲染)===")
  console.log(`  Overlay rects 个数: ${overlay.count}`)

  console.log("\n=== Provider 视觉 bbox 算法 ===")
  if (providerVisual) {
    console.log(`  Length: ${providerVisual.length} (rects ${providerVisual.rectsCount})`)
    console.log(`  Text: ${JSON.stringify(providerVisual.text.slice(0, 300))}`)
  } else {
    console.log(`  ⚠ 算法 fallback 到 null(罕见 — 无 bbox / 无 spans)`)
  }

  console.log("\n=== Verdict ===")
  const nativeRange = [Math.max(1, Math.floor(targets.domLinearExpectedLength * 0.5)), Math.ceil(targets.tlFullTextLength * 0.85)]
  if (native.length === 0) console.log("  ❌ Native selection 为空")
  else if (native.length > targets.tlFullTextLength * 0.85) console.log(`  ❌ Native ${native.length} 越界`)
  else console.log(`  ✅ Native ${native.length}(线性,允许 ${nativeRange[0]}-${nativeRange[1]})— TextLayerBuilder 防越界 OK`)

  if (providerVisual) {
    const visualRange = [Math.max(1, Math.floor(targets.visualExpectedLength * 0.85)), Math.ceil(targets.visualExpectedLength * 1.15)]
    if (providerVisual.length >= visualRange[0] && providerVisual.length <= visualRange[1]) {
      console.log(`  ✅ Provider 视觉 ${providerVisual.length} ≈ 期望 ${targets.visualExpectedLength}(允许 ${visualRange[0]}-${visualRange[1]})— bug 2 chat 文本完整`)
    } else {
      console.log(`  ❌ Provider 视觉 ${providerVisual.length} vs 期望 ${targets.visualExpectedLength}(允许 ${visualRange[0]}-${visualRange[1]})— 算法仍有偏差`)
    }
  }

  if (overlay.count === 0) {
    console.log(`  ❌ 拖拽中无 overlay rects 渲染 — 视觉 overlay 未实时显示,user 拖拽中仍看不到完整选区`)
  } else if (providerVisual && Math.abs(overlay.count - providerVisual.rectsCount) <= 2) {
    console.log(`  ✅ Overlay rects ${overlay.count} ≈ Provider 视觉 spans ${providerVisual.rectsCount} — 拖拽中视觉 overlay 完整`)
  } else if (providerVisual) {
    console.log(`  ⚠ Overlay rects ${overlay.count} vs Provider 视觉 spans ${providerVisual.rectsCount}(差 ${Math.abs(overlay.count - providerVisual.rectsCount)})— 实时 overlay 与 Provider 算法有偏差`)
  } else {
    console.log(`  ✓ Overlay rects ${overlay.count} 已渲染`)
  }

  cdp.close()
}

main().catch(e => { console.error("Failed:", e); process.exit(1) })
