import { getCurrentWindowTabs } from "../utils/browser-context"

type ExtractionResult = { success: boolean; markdown?: string; error?: string }

interface PageDimensions {
  scrollWidth: number
  scrollHeight: number
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  originalScrollX: number
  originalScrollY: number
}

async function captureScreenshot(tabId?: number): Promise<{ screenshot?: string; error?: string }> {
  try {
    if (tabId) {
      const tab = await chrome.tabs.get(tabId)

      if (!tab.active) {
        await chrome.tabs.update(tabId, { active: true })
        await new Promise((r) => setTimeout(r, 100))
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      return { screenshot: dataUrl }
    }

    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" })
    return { screenshot: dataUrl }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("Cannot access") || msg.includes("chrome://") || msg.includes("edge://")) {
      return { error: "Cannot capture browser pages (chrome://, edge://, etc.)" }
    }
    if (msg.includes("No window with id") || msg.includes("No tab with id")) {
      return { error: "Tab not found. Try refreshing the page." }
    }
    return { error: msg }
  }
}

async function capturePageMarkdown(tabId: number): Promise<{ markdown?: string; error?: string }> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTENT" })
    if (result?.success && result.markdown) {
      return { markdown: result.markdown }
    }
  } catch {
    console.log("[Eidorail] Content script not available, using fallback extraction")
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageContentFallback,
    })
    const result = results[0]?.result
    if (result?.success) {
      return { markdown: result.markdown }
    }
    return { error: result?.error || "Failed to extract page content" }
  } catch (error) {
    return { error: `Extraction failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function captureSelectionMarkdown(tabId: number): Promise<{ markdown?: string; error?: string }> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_SELECTION" })
    if (result?.success && result.markdown) {
      return { markdown: result.markdown }
    }
    if (result?.error) {
      return { error: result.error }
    }
  } catch {
    console.log("[Eidorail] Content script not available, using fallback extraction")
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractSelectionFallback,
    })
    const result = results[0]?.result
    if (result?.success) {
      return { markdown: result.markdown }
    }
    return { error: result?.error || "No text selected" }
  } catch (error) {
    return { error: `Extraction failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function getPageDimensionsScript(): PageDimensions {
  return {
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      document.documentElement.offsetWidth,
    ),
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight,
    ),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
  }
}

function scrollToScript(x: number, y: number): void {
  window.scrollTo(x, y)
}

function restoreScrollScript(x: number, y: number): void {
  window.scrollTo(x, y)
}

async function captureFullPageScreenshot(tabId: number): Promise<{ screenshot?: string; error?: string }> {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.active) {
      await chrome.tabs.update(tabId, { active: true })
      await new Promise((r) => setTimeout(r, 150))
    }

    const dimResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: getPageDimensionsScript,
    })
    const dimensions = dimResults[0]?.result as PageDimensions
    if (!dimensions) {
      return { error: "Could not get page dimensions" }
    }

    const {
      scrollWidth,
      scrollHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
      originalScrollX,
      originalScrollY,
    } = dimensions

    if (scrollHeight <= viewportHeight && scrollWidth <= viewportWidth) {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "png" })
      return { screenshot: dataUrl }
    }

    const tiles: { dataUrl: string; x: number; y: number }[] = []
    const ySteps = Math.ceil(scrollHeight / viewportHeight)
    const xSteps = Math.ceil(scrollWidth / viewportWidth)

    for (let yi = 0; yi < ySteps; yi++) {
      for (let xi = 0; xi < xSteps; xi++) {
        const scrollX = xi * viewportWidth
        const scrollY = yi * viewportHeight

        await chrome.scripting.executeScript({
          target: { tabId },
          func: scrollToScript,
          args: [scrollX, scrollY],
        })

        await new Promise((r) => setTimeout(r, 100))

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "png" })
        tiles.push({ dataUrl, x: scrollX, y: scrollY })
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: restoreScrollScript,
      args: [originalScrollX, originalScrollY],
    })

    const stitchResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: stitchTilesInPage,
      args: [tiles, scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio],
    })

    const finalDataUrl = stitchResults[0]?.result as string
    if (!finalDataUrl) {
      return { error: "Failed to stitch screenshots" }
    }

    return { screenshot: finalDataUrl }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Full page capture failed: ${msg}` }
  }
}

function stitchTilesInPage(
  tiles: { dataUrl: string; x: number; y: number }[],
  totalWidth: number,
  totalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  dpr: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas")
    canvas.width = totalWidth * dpr
    canvas.height = totalHeight * dpr

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      reject("Could not get canvas context")
      return
    }

    let loaded = 0
    const images: { img: HTMLImageElement; x: number; y: number }[] = []

    for (const tile of tiles) {
      const img = new Image()
      img.onload = () => {
        images.push({ img, x: tile.x * dpr, y: tile.y * dpr })
        loaded++
        if (loaded === tiles.length) {
          for (const { img, x, y } of images) {
            ctx.drawImage(img, x, y)
          }
          resolve(canvas.toDataURL("image/png"))
        }
      }
      img.onerror = () => reject("Failed to load tile image")
      img.src = tile.dataUrl
    }
  })
}

function extractPageContentFallback(): ExtractionResult {
  const title = document.title || "Untitled"
  const url = window.location.href

  const mainContent = document.querySelector("main, article, [role='main'], .main-content, #main-content")
  const content = mainContent || document.body

  const clone = content.cloneNode(true) as HTMLElement
  clone.querySelectorAll("script, style, nav, header, footer, aside, iframe, noscript").forEach((el) => el.remove())

  clone.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    h.textContent = `${"#".repeat(parseInt(h.tagName[1]))} ${h.textContent?.trim()}`
  })

  const text = clone.innerText || clone.textContent || ""
  const cleanedText = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n")

  const timestamp = new Date().toLocaleString()
  const formatted = `# ${title}\n\n> **Source**: ${url}\n> **Captured**: ${timestamp}\n\n${cleanedText}`

  return { success: true, markdown: formatted }
}

function extractSelectionFallback(): ExtractionResult {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) {
    return { success: false, error: "No text selected" }
  }

  const text = selection.toString().trim()
  if (!text) {
    return { success: false, error: "Selection is empty" }
  }

  const title = document.title || "Untitled"
  const url = window.location.href
  const formatted = `> Selected from [${title}](${url})\n\n${text}`

  return { success: true, markdown: formatted }
}

export default defineBackground(() => {
  console.log("[Eidorail] Background service worker started")

  // Open sidepanel when extension icon is clicked
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
    }
  })

  // Handle keyboard commands
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-side-panel") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id })
      }
    }
  })

  // Set sidepanel behavior to open on action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

  // Listen for messages from sidepanel or content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Eidorail] Received message:", message.type)

    switch (message.type) {
      case "GET_CURRENT_TAB":
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          sendResponse({ tab })
        })
        return true // Will respond asynchronously

      case "CAPTURE_SCREENSHOT":
        captureScreenshot(message.tabId)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ error: error.message }))
        return true

      case "CAPTURE_FULL_PAGE_SCREENSHOT":
        if (message.tabId) {
          captureFullPageScreenshot(message.tabId)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }))
          return true
        }
        sendResponse({ error: "No tabId provided" })
        return true

      case "GET_PAGE_CONTENT":
        if (message.tabId) {
          chrome.scripting
            .executeScript({
              target: { tabId: message.tabId },
              func: () => document.body.innerText,
            })
            .then((results) => {
              sendResponse({ content: results[0]?.result || "" })
            })
            .catch((error) => {
              sendResponse({ error: error.message })
            })
          return true
        }
        break

      case "GET_TABS_WITH_GROUPS":
        getCurrentWindowTabs()
          .then((tabs) => {
            sendResponse({ tabs })
          })
          .catch((error) => {
            sendResponse({ error: error.message })
          })
        return true

      case "CAPTURE_PAGE_MARKDOWN":
        if (message.tabId) {
          capturePageMarkdown(message.tabId)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }))
          return true
        }
        sendResponse({ error: "No tabId provided" })
        return true

      case "CAPTURE_SELECTION_MARKDOWN":
        if (message.tabId) {
          captureSelectionMarkdown(message.tabId)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }))
          return true
        }
        sendResponse({ error: "No tabId provided" })
        return true

      default:
        console.log("[Eidorail] Unknown message type:", message.type)
    }
  })

  // Listen for external messages from Eidolon Sync extension
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    console.log("[Eidorail] External message from:", sender.id, message.type)

    switch (message.type) {
      case "IMPORT_PROJECT":
        // Handle project import from Eidolon Sync
        // This will open the project in OpenCode
        sendResponse({ success: true })
        break

      case "PING":
        sendResponse({ pong: true, version: "0.1.0" })
        break

      default:
        sendResponse({ error: "Unknown message type" })
    }
  })
})
