// FORK: 真桌面 DeskFox CDP 自查脚本(纯 WebSocket,不依赖 Playwright connectOverCDP)
// connectOverCDP 在 WebView2 上 ws connect timeout,改用 raw CDP via WebSocket + Runtime.evaluate。
// 用法:
//   1. Launch DeskFox with env WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   2. 打开一个 PDF/office 文件预览(textLayer 渲染出来)
//   3. bun packages/app/scripts/inspect-pdf-selection.mjs
//
// [feat: office-选中加聊天] 2026-05-25

const CDP_HTTP = "http://localhost:9222"

async function listPages() {
  const res = await fetch(`${CDP_HTTP}/json`)
  return res.json()
}

function callCdp(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = 1
    const timeout = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error(`CDP ${method} timeout`))
    }, 10000)
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data))
      if (msg.id === id) {
        clearTimeout(timeout)
        try { ws.close() } catch {}
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
    ws.addEventListener("error", (e) => {
      clearTimeout(timeout)
      reject(e)
    })
  })
}

async function evalInPage(wsUrl, expression) {
  const result = await callCdp(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`page eval error: ${result.exceptionDetails.text}`)
  }
  return result.result.value
}

async function main() {
  const pages = await listPages()
  console.log(`Found ${pages.length} CDP target(s)`)

  const deskfoxPage = pages.find(
    (p) => p.type === "page" && p.url.startsWith("http://tauri.localhost"),
  )
  if (!deskfoxPage) {
    console.error("DeskFox page not found in CDP targets")
    process.exit(1)
  }

  console.log(`\nDeskFox page: ${deskfoxPage.title}`)
  console.log(`URL: ${deskfoxPage.url}`)

  const wsUrl = deskfoxPage.webSocketDebuggerUrl

  const stats = await evalInPage(
    wsUrl,
    `(() => {
      const textLayers = document.querySelectorAll(".textLayer")
      const stats = {
        textLayerCount: textLayers.length,
        textLayersWithEndOfContent: 0,
        textLayersSelecting: 0,
        sampleSpans: 0,
        sampleText: "",
      }
      textLayers.forEach((tl) => {
        if (tl.querySelector(":scope > .endOfContent")) stats.textLayersWithEndOfContent++
        if (tl.classList.contains("selecting")) stats.textLayersSelecting++
      })
      if (textLayers.length > 0) {
        const first = textLayers[0]
        stats.sampleSpans = first.querySelectorAll("span").length
        stats.sampleText = (first.textContent || "").slice(0, 200)
      }
      const sel = window.getSelection()
      const selText = sel ? sel.toString() : ""
      return {
        ...stats,
        pdfViewerCount: document.querySelectorAll('[data-slot="pdf-viewer"]').length,
        chatLogCount: document.querySelectorAll('[data-slot="session-turn-list"]').length,
        currentSelectionLength: selText.length,
        currentSelectionSample: selText.slice(0, 200),
      }
    })()`,
  )

  console.log("\n=== DOM stats ===")
  console.log(`  pdf-viewer wraps: ${stats.pdfViewerCount}`)
  console.log(`  chat-log: ${stats.chatLogCount}`)
  console.log(`  textLayer count: ${stats.textLayerCount}`)
  console.log(`  textLayers with .endOfContent: ${stats.textLayersWithEndOfContent}`)
  console.log(`  textLayers currently .selecting: ${stats.textLayersSelecting}`)
  console.log(`  sample textLayer spans: ${stats.sampleSpans}`)
  console.log(`  sample text (first 200 chars): ${JSON.stringify(stats.sampleText)}`)
  console.log(`  current selection length: ${stats.currentSelectionLength}`)
  console.log(`  current selection sample: ${JSON.stringify(stats.currentSelectionSample)}`)

  console.log("\n=== Verdict ===")
  if (stats.textLayerCount === 0) {
    console.log("  ⚠ No textLayer rendered — user 没打开 PDF/office,或预览渲染未完成")
  } else if (stats.textLayersWithEndOfContent === stats.textLayerCount) {
    console.log(`  ✅ All ${stats.textLayerCount} textLayer(s) have .endOfContent — TextLayerBuilder 接上了`)
  } else {
    console.log(
      `  ❌ Only ${stats.textLayersWithEndOfContent}/${stats.textLayerCount} textLayer(s) have .endOfContent — fix 未生效`,
    )
  }
}

main().catch((e) => {
  console.error("Failed:", e)
  process.exit(1)
})
