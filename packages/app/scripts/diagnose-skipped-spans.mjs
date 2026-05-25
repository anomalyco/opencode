// FORK: 诊断"红框内容选区漏掉"bug — 检查那些视觉中间但 DOM 顺序外的 spans 在哪
// [feat: office-选中加聊天] 2026-05-25

const CDP_HTTP = "http://localhost:9222"

async function listPages() {
  const r = await fetch(`${CDP_HTTP}/json`)
  return r.json()
}

class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.nextId = 1; this.pending = new Map() }
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`timeout`)) } }, 10000)
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

async function main() {
  const pages = await listPages()
  const dpage = pages.find(p => p.type === "page" && p.url.startsWith("http://tauri.localhost"))
  const cdp = new CdpClient(dpage.webSocketDebuggerUrl)
  await cdp.connect()

  // 找包含 "错题分布" 的 span,看它在哪个 textLayer / markedContent
  const search = await cdp.eval(`(() => {
    const keywords = ["错题分布", "按题型", "古文/白话材料题", "图表/年代尺题", "第一步", "圈\\"时间词\\"", "三步圈完"]
    const results = []
    const allTl = Array.from(document.querySelectorAll(".textLayer"))
    const allSpans = []
    allTl.forEach((tl, tlIdx) => {
      const spans = Array.from(tl.querySelectorAll("span"))
      spans.forEach((s, spIdx) => {
        allSpans.push({ tl, tlIdx, span: s, spIdx, text: s.textContent || "" })
      })
    })
    for (const kw of keywords) {
      const found = allSpans.find(x => x.text.includes(kw))
      if (found) {
        const r = found.span.getBoundingClientRect()
        // ancestor chain
        let parent = found.span.parentElement
        const ancestorChain = []
        let depth = 0
        while (parent && depth < 8) {
          ancestorChain.push({ tag: parent.tagName, cls: parent.className, depth })
          parent = parent.parentElement
          depth++
        }
        results.push({
          keyword: kw,
          text: found.text,
          tlIdx: found.tlIdx,
          spIdx: found.spIdx,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          ancestorChain: ancestorChain.slice(0, 6),
        })
      } else {
        results.push({ keyword: kw, NOT_FOUND: true })
      }
    }
    return {
      textLayerCount: allTl.length,
      totalSpans: allSpans.length,
      results,
    }
  })()`)

  console.log("=== TextLayer count:", search.textLayerCount, "Total spans:", search.totalSpans)
  console.log("\n=== Keyword search ===")
  for (const r of search.results) {
    if (r.NOT_FOUND) {
      console.log(`  ❌ "${r.keyword}" — NOT FOUND in any textLayer span`)
    } else {
      console.log(`  ✅ "${r.keyword}" found in tl#${r.tlIdx} span#${r.spIdx} at y=${r.rect.top.toFixed(0)} text=${JSON.stringify(r.text.slice(0, 30))}`)
      console.log(`     ancestors:`, r.ancestorChain.map(a => `${a.tag}.${a.cls || "(none)"}`).join(" → "))
    }
  }

  cdp.close()
}

main().catch(e => { console.error("Failed:", e); process.exit(1) })
