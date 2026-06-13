import { ipcMain, BrowserWindow, webContents } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { createServer, type Server } from "node:http"
import { executeComputerUse } from "./computer-use"

export interface BrowserAction {
  action: "navigate" | "click" | "type" | "scroll" | "screenshot" | "getContent" | "getUrl"
  url?: string
  x?: number
  y?: number
  text?: string
  clear?: boolean
  down?: boolean
  amount?: number
}

export interface BrowserActionResult {
  success: boolean
  url?: string
  title?: string
  content?: string
  screenshot?: { buffer: ArrayBuffer; width: number; height: number }
  error?: string
}

type BrowserPageElement = {
  index: number
  tag: string
  text: string
  href: string
  type: string
  placeholder: string
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

let automationServer: Server | null = null
let activeWebviewId: number | undefined

function isBrowserAction(input: unknown): input is BrowserAction {
  if (!input || typeof input !== "object" || !("action" in input)) return false
  const action = input.action
  return (
    action === "navigate" ||
    action === "click" ||
    action === "type" ||
    action === "scroll" ||
    action === "screenshot" ||
    action === "getContent" ||
    action === "getUrl"
  )
}

function readWebviewInfo(webview: Electron.WebContents | null) {
  if (!webview || isWebContentsDestroyed(webview)) {
    return { url: "", title: "" }
  }

  try {
    return {
      url: webview.getURL(),
      title: webview.getTitle(),
    }
  } catch {
    return { url: "", title: "" }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isWebContentsDestroyed(webContents: Electron.WebContents) {
  try {
    return webContents.isDestroyed()
  } catch {
    return true
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function getRegisteredActiveWebview() {
  if (activeWebviewId === undefined) return
  const wc = webContents.fromId(activeWebviewId)
  if (wc && !isWebContentsDestroyed(wc)) return wc
  activeWebviewId = undefined
}

function findFallbackWebview() {
  const views = webContents.getAllWebContents().filter((wc) => !isWebContentsDestroyed(wc))
  const embedded = views.find((wc) => wc.getType() === "webview")
  if (embedded) return embedded

  return (
    views.find((wc) => {
      const url = wc.getURL()
      return (url.startsWith("http://") || url.startsWith("https://")) && !url.includes("127.0.0.1") && !url.includes("localhost")
    }) ?? undefined
  )
}

function findSingleEmbeddedWebview() {
  const embedded = webContents.getAllWebContents().filter((wc) => !isWebContentsDestroyed(wc) && wc.getType() === "webview")
  return embedded.length === 1 ? embedded[0] : undefined
}

export function getActiveWebview(): Electron.WebContents | null {
  return getRegisteredActiveWebview() ?? findFallbackWebview() ?? null
}

export function registerActiveWebview(id: number) {
  activeWebviewId = id
}

export function clearActiveWebview(id?: number) {
  if (id === undefined || activeWebviewId === id) activeWebviewId = undefined
}

async function executeJavaScript<T = unknown>(webContents: Electron.WebContents, script: string, timeoutMs = 3000): Promise<T> {
  return withTimeout(webContents.executeJavaScript(script, true), timeoutMs, "Browser JavaScript execution")
}

async function waitForDocumentReady(webview: Electron.WebContents, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (isWebContentsDestroyed(webview)) return false
    const readyState = await executeJavaScript<string>(webview, "document.readyState").catch(() => "")
    if (readyState === "interactive" || readyState === "complete") return true
    await sleep(100)
  }
  return false
}

function webviewMatchesUrl(webview: Electron.WebContents, url?: string) {
  if (!url) return true
  return readWebviewInfo(webview).url === url
}

async function waitForActivatedWebview(timeoutMs: number, url?: string) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const webview = getRegisteredActiveWebview() ?? findSingleEmbeddedWebview()
    if (webview && !isWebContentsDestroyed(webview) && webviewMatchesUrl(webview, url)) return webview
    await sleep(100)
  }
}

async function activateBrowserTab(url?: string) {
  activeWebviewId = undefined

  const started = Date.now()
  while (Date.now() - started < 5000) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.show()
      win.focus()
      win.webContents.send("activate-browser-tab", { url })
    }

    const webview = await waitForActivatedWebview(500, url)
    if (webview && !isWebContentsDestroyed(webview)) return webview
  }
}

export async function executeBrowserAction(action: BrowserAction): Promise<BrowserActionResult> {
  if (action.action === "navigate" && !action.url) return { success: false, error: "URL required" }

  let webview = getRegisteredActiveWebview()

  if (!webview || isWebContentsDestroyed(webview) || action.action === "navigate") {
    webview = await activateBrowserTab(action.action === "navigate" ? action.url : undefined)
    if (!webview || isWebContentsDestroyed(webview)) {
      return { success: false, error: "Could not activate browser session. Please try clicking the Browser tab manually." }
    }
  }

  try {
    switch (action.action) {
      case "navigate": {
        if (!(await waitForDocumentReady(webview, 10000))) {
          return { success: false, error: "Browser page did not become ready" }
        }
        return { success: true, ...readWebviewInfo(webview) }
      }

      case "click": {
        if (action.x === undefined || action.y === undefined) {
          return { success: false, error: "X and Y coordinates required" }
        }
        await executeJavaScript<boolean>(webview, `
          (() => {
            const element = document.elementFromPoint(${action.x}, ${action.y});
            if (element) {
              element.click();
              return true;
            }
            return false;
          })()
        `)
        await sleep(1000)
        return { success: true, url: webview.getURL(), title: webview.getTitle() }
      }

      case "type": {
        if (action.x === undefined || action.y === undefined || !action.text) {
          return { success: false, error: "X, Y coordinates and text required" }
        }
        const text = JSON.stringify(action.text)
        await executeJavaScript<boolean>(webview, `
          (() => {
            const element = document.elementFromPoint(${action.x}, ${action.y});
            if (element) {
              if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                ${action.clear ? "element.value = '';" : ""}
                element.value = ${text};
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                element.textContent = ${text};
              }
              return true;
            }
            return false;
          })()
        `)
        return { success: true, url: webview.getURL(), title: webview.getTitle() }
      }

      case "scroll": {
        const down = action.down !== false
        const amount = action.amount || 3
        await executeJavaScript<void>(webview, `
          window.scrollBy({
            top: ${down ? amount * 300 : -amount * 300},
            behavior: 'smooth'
          });
        `)
        await sleep(500)
        return { success: true, url: webview.getURL(), title: webview.getTitle() }
      }

      case "screenshot": {
        if (!(await waitForDocumentReady(webview))) return { success: false, error: "Browser page did not become ready" }
        const image = await withTimeout(webview.capturePage(), 5000, "Browser screenshot capture")
        if (image.isEmpty()) await sleep(500)
        const retryImage = image.isEmpty() ? await withTimeout(webview.capturePage(), 5000, "Browser screenshot capture") : image
        if (retryImage.isEmpty()) {
          return { success: false, error: "Screenshot failed" }
        }
        const info = readWebviewInfo(webview)
        return {
          success: true,
          ...info,
          screenshot: {
            buffer: retryImage.toPNG().buffer,
            width: retryImage.getSize().width,
            height: retryImage.getSize().height,
          },
        }
      }

      case "getContent": {
        if (!(await waitForDocumentReady(webview))) return { success: false, error: "Browser page did not become ready" }
        const content = await executeJavaScript<string>(webview, `
          (() => {
            // Get main content
            const article = document.querySelector('article');
            const main = document.querySelector('main');
            const body = document.body;

            const getText = (el) => {
              const clone = el.cloneNode(true);
              // Remove script and style tags
              clone.querySelectorAll('script, style, nav, header, footer, aside').forEach(e => e.remove());
              return clone.innerText || clone.textContent;
            };

            let text = '';
            if (article) text = getText(article);
            else if (main) text = getText(main);
            else text = getText(body);

            // Truncate to avoid huge responses
            return text.substring(0, 10000);
          })()
        `)
        return {
          success: true,
          ...readWebviewInfo(webview),
          content,
        }
      }

      case "getUrl": {
        const info = readWebviewInfo(webview)
        if (!info.url && !info.title) {
          webview = await activateBrowserTab()
        }
        return {
          success: true,
          ...readWebviewInfo(webview ?? null),
        }
      }

      default:
        return { success: false, error: "Unknown action" }
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function startBrowserAutomationServer(port: number) {
  if (automationServer) return

  automationServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(200)
      res.end()
      return
    }

    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", async () => {
      try {
        if (req.url === "/browser-automation") {
          const action: unknown = JSON.parse(body)
          if (!isBrowserAction(action)) {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ success: false, error: "Invalid browser automation action" }))
            return
          }
          const result = await executeBrowserAction(action)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(result))
        } else if (req.url === "/computer-use") {
          const action = JSON.parse(body)
          const result = await executeComputerUse(action)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(result))
        } else {
          res.writeHead(404)
          res.end(JSON.stringify({ error: "Not found" }))
        }
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: false, error: String(error) }))
      }
    })
  })

  automationServer.listen(port, "127.0.0.1")
}

export function stopBrowserAutomationServer() {
  if (automationServer) {
    automationServer.close()
    automationServer = null
  }
}

export function registerBrowserAutomationHandlers() {
  ipcMain.handle("browser-automation", async (_event: IpcMainInvokeEvent, action: BrowserAction) => {
    return executeBrowserAction(action)
  })

  ipcMain.handle("browser-set-active-webview", (_event: IpcMainInvokeEvent, id: number) => {
    registerActiveWebview(id)
    return true
  })

  ipcMain.handle("browser-clear-active-webview", (_event: IpcMainInvokeEvent, id?: number) => {
    clearActiveWebview(id)
    return true
  })

  ipcMain.handle("browser-get-page-info", async () => {
    const webview = getActiveWebview()
    if (!webview || webview.isDestroyed()) {
      return { success: false, error: "No active browser" }
    }

    const url = webview.getURL()
    const title = webview.getTitle()

    // Get clickable elements
    const elements = await executeJavaScript<BrowserPageElement[]>(webview, `
      (() => {
        const elements = document.querySelectorAll('a, button, input, textarea, select');
        return Array.from(elements).slice(0, 50).map((el, i) => ({
          index: i,
          tag: el.tagName.toLowerCase(),
          text: el.innerText?.substring(0, 100) || el.value?.substring(0, 100) || '',
          href: el.href || '',
          type: el.type || '',
          placeholder: el.placeholder || '',
          rect: el.getBoundingClientRect()
        }));
      })()
    `)

    return {
      success: true,
      url,
      title,
      elements: elements.map((element) => ({
        index: element.index,
        tag: element.tag,
        text: element.text,
        href: element.href,
        type: element.type,
        placeholder: element.placeholder,
        x: Math.round(element.rect.x + element.rect.width / 2),
        y: Math.round(element.rect.y + element.rect.height / 2),
      })),
    }
  })
}
