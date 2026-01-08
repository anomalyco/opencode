#!/usr/bin/env node
/**
 * Browser Manager Server - Runs on Node.js to manage Chromium profiles
 * Spawned by main OpenCode (Bun) process
 */

import { chromium } from "playwright"
import http from "http"
import { URL } from "url"

let browser = null
let context = null
let currentPage = null
let pages = [] // Track all pages for tab management
let consoleMessages = []
let networkRequests = []
let fileChooserPromise = null
let dialogPromise = null
let cursorPosition = { x: 0, y: 0 }

const PORT = process.env.BROWSER_MANAGER_PORT || 9999

/**
 * Inject cursor overlay script into the page
 */
const CURSOR_OVERLAY_SCRIPT = `
(function() {
  if (window.__opencodeCursorInitialized) return;
  window.__opencodeCursorInitialized = true;

  // Create cursor element with high visibility
  const cursor = document.createElement('div');
  cursor.id = '__opencode-cursor';
  cursor.style.cssText = \`
    position: fixed;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle, #ff0000 0%, #cc0000 40%, #ff0000 70%, transparent 100%);
    border: 3px solid #0000ff;
    box-shadow: 0 0 10px #ff0000, 0 0 20px #ff0000, inset 0 0 5px rgba(255,255,255,0.6);
    pointer-events: none;
    z-index: 2147483647;
    transform: translate(-50%, -50%);
    transition: none;
    display: block;
    opacity: 1;
  \`;

  // Create click effect element
  const clickEffect = document.createElement('div');
  clickEffect.id = '__opencode-click-effect';
  clickEffect.style.cssText = \`
    position: fixed;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid rgba(59, 130, 246, 0.8);
    pointer-events: none;
    z-index: 2147483646;
    transform: translate(-50%, -50%) scale(0);
    opacity: 0;
    display: none;
  \`;

  document.body.appendChild(cursor);
  document.body.appendChild(clickEffect);

  // Store in window for access
  window.__opencodeCursor = {
    element: cursor,
    clickEffect: clickEffect,
    position: { x: 0, y: 0 },
    visible: true,

    moveTo(x, y, animate = false) {
      this.position = { x, y };
      if (animate) {
        cursor.style.transition = 'left 0.3s ease-out, top 0.3s ease-out';
      } else {
        cursor.style.transition = 'none';
      }
      cursor.style.left = x + 'px';
      cursor.style.top = y + 'px';
    },

    animateTo(fromX, fromY, toX, toY, duration = 300) {
      return new Promise((resolve) => {
        const steps = 20;
        const dx = (toX - fromX) / steps;
        const dy = (toY - fromY) / steps;
        let step = 0;

        const interval = setInterval(() => {
          step++;
          const x = fromX + dx * step;
          const y = fromY + dy * step;
          cursor.style.left = x + 'px';
          cursor.style.top = y + 'px';
          this.position = { x, y };

          if (step >= steps) {
            clearInterval(interval);
            resolve();
          }
        }, duration / steps);
      });
    },

    showClickEffect(x, y) {
      clickEffect.style.display = 'block';
      clickEffect.style.left = x + 'px';
      clickEffect.style.top = y + 'px';
      clickEffect.style.transform = 'translate(-50%, -50%) scale(0)';
      clickEffect.style.opacity = '1';

      // Animate
      requestAnimationFrame(() => {
        clickEffect.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
        clickEffect.style.transform = 'translate(-50%, -50%) scale(1.5)';
        clickEffect.style.opacity = '0';
      });

      setTimeout(() => {
        clickEffect.style.display = 'none';
      }, 300);
    },

    show() {
      cursor.style.display = 'block';
      this.visible = true;
    },

    hide() {
      cursor.style.display = 'none';
      this.visible = false;
    },

    setDragging(isDragging) {
      if (isDragging) {
        cursor.style.background = 'radial-gradient(circle, rgba(239, 68, 68, 0.9) 0%, rgba(239, 68, 68, 0.4) 50%, transparent 70%)';
        cursor.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.8), 0 0 20px rgba(239, 68, 68, 0.4)';
      } else {
        cursor.style.background = 'radial-gradient(circle, rgba(59, 130, 246, 0.9) 0%, rgba(59, 130, 246, 0.4) 50%, transparent 70%)';
        cursor.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.8), 0 0 20px rgba(59, 130, 246, 0.4)';
      }
    }
  };

  // Position cursor initially off-screen
  cursor.style.left = '-100px';
  cursor.style.top = '-100px';
})();
`

// Simple HTTP server for browser commands
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json")

  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const pathname = url.pathname

    // Health check
    if (pathname === "/health") {
      res.writeHead(200)
      res.end(JSON.stringify({ status: "ok" }))
      return
    }

    if (pathname === "/init") {
      const headed = url.searchParams.get("headed") === "true"

      if (!browser) {
        console.log("[browser-server] Launching Chromium...")
        browser = await chromium.launch({
          headless: !headed,
          timeout: 30000,
        })
        console.log("[browser-server] Chromium launched")
      }

      if (!context) {
        context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
        })
        console.log("[browser-server] Context created")
      }

      if (!currentPage) {
        currentPage = await context.newPage()
        pages.push(currentPage)
        console.log("[browser-server] Page created")

        // Set up console message listener
        currentPage.on("console", (msg) => {
          consoleMessages.push({
            level: msg.type(),
            text: msg.text(),
            timestamp: Date.now(),
          })
          // Keep only last 100 messages
          if (consoleMessages.length > 100) {
            consoleMessages.shift()
          }
        })

        // Set up network request listener
        currentPage.on("response", (response) => {
          const request = response.request()
          networkRequests.push({
            url: request.url(),
            method: request.method(),
            status: response.status(),
            type: request.resourceType(),
          })
          // Keep only last 200 requests
          if (networkRequests.length > 200) {
            networkRequests.shift()
          }
        })

        // Set up dialog handler
        currentPage.on("dialog", async (dialog) => {
          if (dialogPromise) {
            const { accept, promptText, resolve } = dialogPromise
            if (accept) {
              await dialog.accept(promptText || undefined)
            } else {
              await dialog.dismiss()
            }
            resolve({ success: true })
            dialogPromise = null
          } else {
            // Auto-dismiss if no handler waiting
            await dialog.dismiss()
          }
        })

        // Set up file chooser handler
        currentPage.on("filechooser", async (chooser) => {
          if (fileChooserPromise) {
            const { paths, resolve } = fileChooserPromise
            if (paths && paths.length > 0) {
              await chooser.setFiles(paths)
            }
            resolve({ success: true })
            fileChooserPromise = null
          }
        })

        // Inject cursor overlay
        await currentPage.addInitScript(CURSOR_OVERLAY_SCRIPT)
      }

      res.writeHead(200)
      res.end(JSON.stringify({ success: true, message: "Browser initialized" }))
      return
    }

    if (!currentPage) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: "Browser not initialized" }))
      return
    }

    if (pathname === "/navigate") {
      const urlStr = url.searchParams.get("url")
      const waitUntil = url.searchParams.get("waitUntil") || "domcontentloaded"

      if (!urlStr) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: "URL is required" }))
        return
      }

      console.log("[browser-server] Navigating to:", urlStr)

      try {
        await currentPage.goto(urlStr, { waitUntil, timeout: 60000 })
      } catch (navError) {
        console.error("[browser-server] Navigation error:", navError.message)
        // Continue even if navigation fails - page might be partially loaded
      }

      const pageInfo = await getPageInfo()

      res.writeHead(200)
      res.end(JSON.stringify(pageInfo))
      return
    }

    if (pathname === "/pageInfo") {
      try {
        const pageInfo = await getPageInfo()
        res.writeHead(200)
        res.end(JSON.stringify(pageInfo))
      } catch (err) {
        console.error("[browser-server] pageInfo error:", err.message)
        res.writeHead(200)
        res.end(JSON.stringify({ url: "", title: "", viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 0 } }))
      }
      return
    }

    if (pathname === "/screenshot") {
      const fullPage = url.searchParams.get("fullPage") === "true"
      console.log("[browser-server] Taking screenshot")

      const buffer = await currentPage.screenshot({ fullPage })
      res.writeHead(200, { "Content-Type": "image/png" })
      res.end(buffer)
      return
    }

    if (pathname === "/click") {
      const selector = (url.searchParams.get("selector") || "").trim()
      const rawX = url.searchParams.get("x")
      const rawY = url.searchParams.get("y")
      const button = url.searchParams.get("button") || "left"
      const clickCount = parseInt(url.searchParams.get("clickCount") || "1", 10)
      const timeout = parseInt(url.searchParams.get("timeout") || "30000", 10)

      try {
        if (selector) {
          const locator = currentPage.locator(selector).first()
          try {
            // Scroll element into view first if not visible
            await locator.scrollIntoViewIfNeeded()
            await locator.waitFor({ state: "visible", timeout })
          } catch (waitErr) {
            throw new Error("Element not found or not visible")
          }
          await locator.click({ button, clickCount, timeout })
        } else {
          if (rawX === null || rawY === null) {
            throw new Error("Selector or coordinates required")
          }
          const x = Number(rawX)
          const y = Number(rawY)
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("Invalid coordinates")
          }
          await currentPage.mouse.click(x, y, { button, clickCount })
        }

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (clickError) {
        console.error("[browser-server] Click error:", clickError.message)
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: clickError.message }))
      }
      return
    }

    if (pathname === "/type") {
      const selector = url.searchParams.get("selector")
      const text = url.searchParams.get("text") || ""
      const clear = url.searchParams.get("clear") === "true"
      const pressEnter = url.searchParams.get("pressEnter") === "true"
      const delay = parseInt(url.searchParams.get("delay") || "50", 10)
      const timeout = parseInt(url.searchParams.get("timeout") || "30000", 10)

      console.log("[browser-server] Typing in", selector)

      try {
        if (!selector) throw new Error("Selector is required")
        const locator = currentPage.locator(selector).first()

        // Ensure the element is attached/visible
        try {
          await locator.waitFor({ state: "visible", timeout })
        } catch (waitErr) {
          throw new Error("Element not found or not visible")
        }

        if (clear) await locator.fill("")

        if (typeof locator.type === "function") {
          await locator.type(text, { delay })
        } else {
          // Fallback to keyboard typing
          await locator.focus()
          await currentPage.keyboard.type(text, { delay })
        }

        if (pressEnter) await locator.press("Enter")

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (typeError) {
        console.error("[browser-server] Type error:", typeError.message)
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: typeError.message }))
      }

      return
    }

    if (pathname === "/scroll") {
      const direction = url.searchParams.get("direction") || "down"
      const amount = parseInt(url.searchParams.get("amount") || "500", 10)
      const toElement = url.searchParams.get("toElement")

      console.log("[browser-server] Scrolling", direction)

      if (toElement) {
        await currentPage.locator(toElement).first().scrollIntoViewIfNeeded()
      } else {
        await currentPage.evaluate(
          ({ dir, amt }) => {
            const scrollAmount = amt
            switch (dir) {
              case "up":
                window.scrollBy(0, -scrollAmount)
                break
              case "down":
                window.scrollBy(0, scrollAmount)
                break
              case "left":
                window.scrollBy(-scrollAmount, 0)
                break
              case "right":
                window.scrollBy(scrollAmount, 0)
                break
            }
          },
          { dir: direction, amt: amount },
        )
      }

      const scrollPos = await currentPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      res.writeHead(200)
      res.end(JSON.stringify(scrollPos))
      return
    }

    if (pathname === "/wait") {
      const loadState = url.searchParams.get("loadState") || "domcontentloaded"
      const selector = url.searchParams.get("selector")
      const timeout = parseInt(url.searchParams.get("timeout") || "30000", 10)

      console.log("[browser-server] Waiting for", selector || loadState)

      if (selector) {
        await currentPage.locator(selector).first().waitFor({ timeout })
      } else {
        await currentPage.waitForLoadState(loadState, { timeout })
      }

      res.writeHead(200)
      res.end(JSON.stringify({ success: true }))
      return
    }

    if (pathname === "/content") {
      const format = url.searchParams.get("format") || "text"
      const selector = url.searchParams.get("selector")

      console.log("[browser-server] Getting content", format)

      let text = ""
      let html = ""

      try {
        if (selector) {
          const locator = currentPage.locator(selector).first()
          text = (await locator.textContent().catch(() => "")) || ""
          html = (await locator.innerHTML().catch(() => "")) || ""
        } else {
          // For full page text, extract only visible, readable content
          text = await currentPage
            .evaluate(() => {
              // Get text only from visible leaf elements (not parents with children)
              const textContent = []
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false)

              let node
              while ((node = walker.nextNode())) {
                const text = node.textContent?.trim()
                // Only include non-empty text that's not from script/style elements
                if (text && text.length > 0 && text.length < 500) {
                  const parent = node.parentElement
                  const tag = parent?.tagName.toLowerCase()
                  // Skip script, style, noscript, and empty containers
                  if (!["script", "style", "noscript", "meta", "link"].includes(tag)) {
                    textContent.push(text)
                  }
                }
              }

              // Deduplicate and clean
              return [...new Set(textContent)].join(" ").replace(/\s+/g, " ").slice(0, 5000).trim()
            })
            .catch(() => "")

          html = (await currentPage.content().catch(() => "")) || ""
        }
      } catch (contentError) {
        console.error("[browser-server] Content error:", contentError.message)
      }

      res.writeHead(200)
      res.end(JSON.stringify({ text, html }))
      return
    }

    if (pathname === "/elements") {
      const type = url.searchParams.get("type") || "all"
      console.log("[browser-server] Getting interactive elements")

      const elements = await currentPage.evaluate((elementType) => {
        const result = []
        let index = 0

        const selectors =
          elementType === "input"
            ? "input, textarea, select, [contenteditable=true]"
            : elementType === "clickable"
              ? "a, button, [role=button], [onclick], input[type=submit], input[type=button]"
              : "a, button, input, textarea, select, [role=button], [onclick], [contenteditable=true]"

        document.querySelectorAll(selectors).forEach((el) => {
          const rect = el.getBoundingClientRect()

          // Check if visible
          const style = window.getComputedStyle(el)
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            el.offsetParent === null
          ) {
            return
          }

          // Generate selector
          let selector = el.id ? `#${el.id}` : el.tagName.toLowerCase()
          try {
            selector = el.tagName.toLowerCase()
            if (el.id) selector = `#${el.id}`
          } catch {}

          result.push({
            index: index++,
            tagName: el.tagName.toLowerCase(),
            selector,
            text: (el.innerText || el.value || "").slice(0, 50),
            type: el.type,
            placeholder: el.placeholder,
            ariaLabel: el.getAttribute("aria-label") || "",
            textContent: (el.innerText || "").slice(0, 100),
            bounds: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            isVisible: true,
            isClickable: true,
            isInput: ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
          })
        })

        return result
      }, type)

      res.writeHead(200)
      res.end(JSON.stringify(elements))
      return
    }

    // Hover endpoint
    if (pathname === "/hover") {
      const selector = url.searchParams.get("selector")
      const x = url.searchParams.get("x")
      const y = url.searchParams.get("y")
      const timeout = parseInt(url.searchParams.get("timeout") || "30000", 10)

      console.log("[browser-server] Hovering", selector || `(${x}, ${y})`)

      try {
        if (selector) {
          const locator = currentPage.locator(selector).first()
          await locator.waitFor({ state: "visible", timeout })
          await locator.hover()

          // Get element center for cursor animation
          const box = await locator.boundingBox()
          if (box) {
            cursorPosition = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            await currentPage.evaluate(({ x, y }) => {
              if (window.__opencodeCursor) {
                window.__opencodeCursor.moveTo(x, y, true)
              }
            }, cursorPosition)
          }
        } else if (x && y) {
          await currentPage.mouse.move(parseFloat(x), parseFloat(y))
          cursorPosition = { x: parseFloat(x), y: parseFloat(y) }
          await currentPage.evaluate(({ x, y }) => {
            if (window.__opencodeCursor) {
              window.__opencodeCursor.moveTo(x, y, true)
            }
          }, cursorPosition)
        }

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (hoverError) {
        console.error("[browser-server] Hover error:", hoverError.message)
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: hoverError.message }))
      }
      return
    }

    // Drag endpoint
    if (pathname === "/drag") {
      const startX = parseFloat(url.searchParams.get("startX") || "0")
      const startY = parseFloat(url.searchParams.get("startY") || "0")
      const endX = parseFloat(url.searchParams.get("endX") || "0")
      const endY = parseFloat(url.searchParams.get("endY") || "0")

      console.log("[browser-server] Dragging from", `(${startX}, ${startY})`, "to", `(${endX}, ${endY})`)

      try {
        // Animate cursor to start position
        await currentPage.evaluate(
          async ({ fromX, fromY, toX, toY }) => {
            if (window.__opencodeCursor) {
              window.__opencodeCursor.setDragging(true)
              await window.__opencodeCursor.animateTo(fromX, fromY, toX, toY, 500)
              window.__opencodeCursor.setDragging(false)
            }
          },
          { fromX: startX, fromY: startY, toX: endX, toY: endY },
        )

        // Perform the actual drag
        await currentPage.mouse.move(startX, startY)
        await currentPage.mouse.down()
        await currentPage.mouse.move(endX, endY, { steps: 10 })
        await currentPage.mouse.up()

        cursorPosition = { x: endX, y: endY }

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (dragError) {
        console.error("[browser-server] Drag error:", dragError.message)
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: dragError.message }))
      }
      return
    }

    // Press key endpoint
    if (pathname === "/pressKey") {
      const key = url.searchParams.get("key")
      const modifiers = (url.searchParams.get("modifiers") || "").split(",").filter(Boolean)

      console.log("[browser-server] Pressing key", key, modifiers.length ? `with modifiers: ${modifiers}` : "")

      try {
        // Hold modifiers
        for (const mod of modifiers) {
          await currentPage.keyboard.down(mod)
        }

        await currentPage.keyboard.press(key)

        // Release modifiers
        for (const mod of modifiers.reverse()) {
          await currentPage.keyboard.up(mod)
        }

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (keyError) {
        console.error("[browser-server] Key error:", keyError.message)
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: keyError.message }))
      }
      return
    }

    // Select option endpoint
    if (pathname === "/select") {
      const selector = url.searchParams.get("selector")
      const values = (url.searchParams.get("values") || "").split("|||").filter(Boolean)
      const timeout = parseInt(url.searchParams.get("timeout") || "30000", 10)

      console.log("[browser-server] Selecting", values, "in", selector)

      try {
        const locator = currentPage.locator(selector).first()
        await locator.waitFor({ state: "visible", timeout })
        await locator.selectOption(values)

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (selectError) {
        console.error("[browser-server] Select error:", selectError.message)
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: selectError.message }))
      }
      return
    }

    // Fill form endpoint (POST)
    if (pathname === "/fillForm" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", async () => {
        try {
          const { fields } = JSON.parse(body)
          let filled = 0

          for (const field of fields) {
            try {
              const locator = currentPage.locator(field.selector).first()
              await locator.waitFor({ state: "visible", timeout: 5000 })
              await locator.fill(field.value)
              filled++
            } catch (fieldError) {
              console.error("[browser-server] Fill field error:", field.selector, fieldError.message)
            }
          }

          res.writeHead(200)
          res.end(JSON.stringify({ success: true, filled }))
        } catch (formError) {
          console.error("[browser-server] Fill form error:", formError.message)
          res.writeHead(200)
          res.end(JSON.stringify({ success: false, filled: 0, error: formError.message }))
        }
      })
      return
    }

    // Evaluate JavaScript endpoint (POST)
    if (pathname === "/evaluate" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", async () => {
        try {
          const { code, element, ref } = JSON.parse(body)

          let result
          if (element || ref) {
            const locator = currentPage.locator(ref || element).first()
            const elementHandle = await locator.elementHandle()
            const fn = new Function("element", `return (${code})(element)`)
            result = await currentPage.evaluate(fn, elementHandle)
          } else {
            const fn = new Function(`return (${code})()`)
            result = await currentPage.evaluate(fn)
          }

          res.writeHead(200)
          res.end(JSON.stringify({ success: true, result }))
        } catch (evalError) {
          console.error("[browser-server] Evaluate error:", evalError.message)
          res.writeHead(200)
          res.end(JSON.stringify({ success: false, error: evalError.message }))
        }
      })
      return
    }

    // Console messages endpoint
    if (pathname === "/consoleMessages") {
      const level = url.searchParams.get("level") || "info"
      const levels = {
        error: ["error"],
        warning: ["error", "warning"],
        info: ["error", "warning", "info", "log"],
        log: ["error", "warning", "info", "log", "debug"],
      }

      const allowedLevels = levels[level] || levels.info
      const filtered = consoleMessages.filter((msg) => allowedLevels.includes(msg.level))

      res.writeHead(200)
      res.end(JSON.stringify(filtered))
      return
    }

    // Network requests endpoint
    if (pathname === "/networkRequests") {
      const includeStatic = url.searchParams.get("includeStatic") === "true"
      const staticTypes = ["stylesheet", "image", "font", "media"]

      const filtered = includeStatic
        ? networkRequests
        : networkRequests.filter((req) => !staticTypes.includes(req.type))

      res.writeHead(200)
      res.end(JSON.stringify(filtered))
      return
    }

    // Handle dialog endpoint
    if (pathname === "/handleDialog") {
      const accept = url.searchParams.get("accept") === "true"
      const promptText = url.searchParams.get("promptText")

      // Store the handler for the next dialog
      dialogPromise = {
        accept,
        promptText,
        resolve: (result) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        },
      }

      // If no dialog appears in 5 seconds, respond anyway
      setTimeout(() => {
        if (dialogPromise) {
          dialogPromise = null
          res.writeHead(200)
          res.end(JSON.stringify({ success: true, note: "No dialog appeared" }))
        }
      }, 5000)
      return
    }

    // Upload files endpoint (POST) - supports selector-based file upload
    if (pathname === "/uploadFiles" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", async () => {
        try {
          const { paths, selector } = JSON.parse(body)

          if (selector) {
            // Direct file input selection approach
            const fileInput = await currentPage.locator(selector).first()
            await fileInput.setInputFiles(paths)
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, count: paths.length }))
          } else {
            // Set up the file chooser handler for dialog-based upload
            fileChooserPromise = {
              paths,
              resolve: (result) => {
                res.writeHead(200)
                res.end(JSON.stringify(result))
              },
            }

            // Wait for file chooser to be triggered
            setTimeout(() => {
              if (fileChooserPromise) {
                fileChooserPromise = null
                res.writeHead(200)
                res.end(JSON.stringify({ success: false, error: "No file chooser appeared" }))
              }
            }, 10000)
          }
        } catch (uploadError) {
          res.writeHead(200)
          res.end(JSON.stringify({ success: false, error: uploadError.message }))
        }
      })
      return
    }

    // Resize endpoint
    if (pathname === "/resize") {
      const width = parseInt(url.searchParams.get("width") || "1280", 10)
      const height = parseInt(url.searchParams.get("height") || "720", 10)

      console.log("[browser-server] Resizing to", width, "x", height)

      try {
        await currentPage.setViewportSize({ width, height })
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (resizeError) {
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: resizeError.message }))
      }
      return
    }

    // Tabs management endpoint
    if (pathname === "/tabs") {
      const action = url.searchParams.get("action") || "list"
      const index = parseInt(url.searchParams.get("index") || "-1", 10)

      console.log("[browser-server] Tabs action:", action)

      try {
        switch (action) {
          case "list": {
            const tabList = await Promise.all(
              pages.map(async (page, i) => ({
                index: i,
                url: page.url(),
                title: await page.title().catch(() => ""),
                active: page === currentPage,
              })),
            )
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, tabs: tabList }))
            break
          }

          case "create": {
            const newPage = await context.newPage()
            pages.push(newPage)
            currentPage = newPage

            // Inject cursor overlay
            await currentPage.addInitScript(CURSOR_OVERLAY_SCRIPT)

            res.writeHead(200)
            res.end(JSON.stringify({ success: true, tabs: [{ index: pages.length - 1 }] }))
            break
          }

          case "close": {
            const closeIndex = index >= 0 ? index : pages.indexOf(currentPage)
            if (closeIndex >= 0 && closeIndex < pages.length) {
              await pages[closeIndex].close()
              pages.splice(closeIndex, 1)
              if (pages.length > 0) {
                currentPage = pages[Math.min(closeIndex, pages.length - 1)]
              } else {
                currentPage = null
              }
            }
            res.writeHead(200)
            res.end(JSON.stringify({ success: true }))
            break
          }

          case "select": {
            if (index >= 0 && index < pages.length) {
              currentPage = pages[index]
              await currentPage.bringToFront()
            }
            res.writeHead(200)
            res.end(JSON.stringify({ success: true }))
            break
          }

          default:
            res.writeHead(200)
            res.end(JSON.stringify({ success: false, error: "Unknown action" }))
        }
      } catch (tabsError) {
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: tabsError.message }))
      }
      return
    }

    // Snapshot endpoint (accessibility tree)
    if (pathname === "/snapshot") {
      console.log("[browser-server] Taking accessibility snapshot")

      try {
        const snapshot = await currentPage.accessibility.snapshot()
        const elementMap = {}

        // Flatten the tree and create element map
        function flattenTree(node, path = "") {
          if (!node) return ""
          const ref = path || "root"
          const lines = []

          if (node.role && node.name) {
            elementMap[ref] = { ref, role: node.role, name: node.name }
            lines.push(`- ${node.role} "${node.name}"`)
          }

          if (node.children) {
            node.children.forEach((child, i) => {
              lines.push(flattenTree(child, `${ref}.${i}`))
            })
          }

          return lines.filter(Boolean).join("\n")
        }

        const snapshotText = flattenTree(snapshot)

        res.writeHead(200)
        res.end(JSON.stringify({ snapshot: snapshotText, elementMap }))
      } catch (snapshotError) {
        res.writeHead(200)
        res.end(JSON.stringify({ snapshot: "", elementMap: {}, error: snapshotError.message }))
      }
      return
    }

    // Go back endpoint
    if (pathname === "/goBack") {
      console.log("[browser-server] Going back")

      try {
        await currentPage.goBack()
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (backError) {
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: backError.message }))
      }
      return
    }

    // Go forward endpoint
    if (pathname === "/goForward") {
      console.log("[browser-server] Going forward")

      try {
        await currentPage.goForward()
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (forwardError) {
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: forwardError.message }))
      }
      return
    }

    // List elements by type endpoint
    if (pathname === "/listElements") {
      const type = url.searchParams.get("type") || "all"
      console.log("[browser-server] Listing elements:", type)

      try {
        const elements = await currentPage.evaluate((elementType) => {
          const result = []
          let index = 0

          let selectors
          switch (elementType) {
            case "buttons":
              selectors = 'button, [role="button"], input[type="button"], input[type="submit"]'
              break
            case "inputs":
              selectors = 'input:not([type="button"]):not([type="submit"]):not([type="hidden"])'
              break
            case "textareas":
              selectors = "textarea"
              break
            case "links":
              selectors = "a[href]"
              break
            default:
              selectors = 'a, button, input, textarea, select, [role="button"], [onclick]'
          }

          document.querySelectorAll(selectors).forEach((el) => {
            const rect = el.getBoundingClientRect()
            const style = window.getComputedStyle(el)

            // Skip hidden elements
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0" ||
              rect.width === 0 ||
              rect.height === 0
            ) {
              return
            }

            // Generate unique selector
            let selector = el.tagName.toLowerCase()
            if (el.id) selector = `#${el.id}`
            else if (el.className && typeof el.className === "string") {
              selector = `${el.tagName.toLowerCase()}.${el.className.split(" ").filter(Boolean).join(".")}`
            }

            result.push({
              index: index++,
              tagName: el.tagName.toLowerCase(),
              selector,
              text: (el.innerText || el.value || "").slice(0, 100),
              type: el.type || "",
              placeholder: el.placeholder || "",
              ariaLabel: el.getAttribute("aria-label") || "",
              id: el.id || "",
              className: el.className || "",
              href: el.href || "",
              innerHTML: el.innerHTML?.slice(0, 200) || "",
              bounds: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              isVisible: true,
              isClickable: ["a", "button", "input"].includes(el.tagName.toLowerCase()),
              isInput: ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
            })
          })

          return result
        }, type)

        res.writeHead(200)
        res.end(JSON.stringify(elements))
      } catch (listError) {
        res.writeHead(200)
        res.end(JSON.stringify([]))
      }
      return
    }

    // Search elements endpoint
    if (pathname === "/searchElements") {
      const text = url.searchParams.get("text")
      const innerHTML = url.searchParams.get("innerHTML")
      const id = url.searchParams.get("id")
      const className = url.searchParams.get("className")
      const tagName = url.searchParams.get("tagName")
      const role = url.searchParams.get("role")
      const placeholder = url.searchParams.get("placeholder")

      console.log("[browser-server] Searching elements")

      try {
        const elements = await currentPage.evaluate(
          ({ text, innerHTML, id, className, tagName, role, placeholder }) => {
            // Fuzzy search scoring function
            function fuzzyScore(str, query) {
              if (!query) return 1000 // No filter
              if (!str) return -1
              str = str.toLowerCase()
              query = query.toLowerCase()

              // Exact match gets highest score
              if (str === query) return 1000
              if (str.includes(query)) return 500

              // Fuzzy matching: score based on matching character positions
              let score = 0
              let queryIdx = 0
              let prevIdx = -1

              for (let i = 0; i < str.length && queryIdx < query.length; i++) {
                if (str[i] === query[queryIdx]) {
                  const gap = i - prevIdx
                  score += gap === 1 ? 10 : 1 // Bonus for consecutive matches
                  prevIdx = i
                  queryIdx++
                }
              }

              return queryIdx === query.length ? score : -1 // -1 if not all chars matched
            }

            const candidates = []

            document.querySelectorAll("*").forEach((el) => {
              const rect = el.getBoundingClientRect()

              // Skip invisible elements
              if (rect.width === 0 || rect.height === 0) return

              const elText = (el.innerText || el.value || "").slice(0, 200)
              const elHTML = (el.innerHTML || "").slice(0, 300)
              const elClass = el.className || ""

              // Fuzzy scoring for text matching
              const textScore = fuzzyScore(elText, text)
              const htmlScore = fuzzyScore(elHTML, innerHTML)

              // Exact matching for these fields
              const idMatches = !id || el.id === id
              const classMatches = !className || elClass.includes(className)
              const tagMatches = !tagName || el.tagName.toLowerCase() === tagName.toLowerCase()
              const roleMatches = !role || el.getAttribute("role") === role
              const placeholderMatches = !placeholder || el.placeholder === placeholder

              // Apply filters - all must pass
              const passes = idMatches && classMatches && tagMatches && roleMatches && placeholderMatches

              if (!passes) return

              // If text/html filters are specified, they must have positive scores
              if (text && textScore < 0) return
              if (innerHTML && htmlScore < 0) return

              let selector = el.tagName.toLowerCase()
              if (el.id) selector = `#${el.id}`

              const score = (textScore >= 0 ? textScore : 0) + (htmlScore >= 0 ? htmlScore : 0)

              candidates.push({
                score,
                tagName: el.tagName.toLowerCase(),
                selector,
                text: elText,
                type: el.type || "",
                placeholder: el.placeholder || "",
                ariaLabel: el.getAttribute("role") || "",
                id: el.id || "",
                className: elClass,
                innerHTML: elHTML,
                bounds: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
                isVisible: true,
                isClickable: true,
                isInput: ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
              })
            })

            // Sort by fuzzy score (highest first)
            candidates.sort((a, b) => b.score - a.score)

            // Filter by minimum relevance score to avoid weak/wrong matches
            // Require at least 50 points for text-based filtering (substring or better fuzzy match)
            const minScore = text || innerHTML ? 50 : 0
            const filtered = candidates.filter((item) => item.score >= minScore)

            // Assign indices after sorting and filtering
            const result = filtered.slice(0, 50).map((item, idx) => ({
              ...item,
              index: idx,
            }))

            return result
          },
          { text, innerHTML, id, className, tagName, role, placeholder },
        )

        res.writeHead(200)
        res.end(JSON.stringify(elements))
      } catch (searchError) {
        res.writeHead(200)
        res.end(JSON.stringify([]))
      }
      return
    }

    // Animate cursor endpoint
    if (pathname === "/animateCursor") {
      const fromX = parseFloat(url.searchParams.get("fromX") || "0")
      const fromY = parseFloat(url.searchParams.get("fromY") || "0")
      const toX = parseFloat(url.searchParams.get("toX") || "0")
      const toY = parseFloat(url.searchParams.get("toY") || "0")
      const isDragging = url.searchParams.get("isDragging") === "true"

      try {
        await currentPage.evaluate(
          async ({ fromX, fromY, toX, toY, isDragging }) => {
            if (window.__opencodeCursor) {
              window.__opencodeCursor.show()
              if (isDragging) {
                window.__opencodeCursor.setDragging(true)
              }
              await window.__opencodeCursor.animateTo(fromX, fromY, toX, toY, 300)
              if (isDragging) {
                window.__opencodeCursor.setDragging(false)
              }
            }
          },
          { fromX, fromY, toX, toY, isDragging },
        )

        cursorPosition = { x: toX, y: toY }

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (cursorError) {
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: cursorError.message }))
      }
      return
    }

    // Show/hide cursor endpoint
    if (pathname === "/showCursor") {
      const show = url.searchParams.get("show") === "true"

      try {
        await currentPage.evaluate((show) => {
          if (window.__opencodeCursor) {
            if (show) {
              window.__opencodeCursor.show()
            } else {
              window.__opencodeCursor.hide()
            }
          }
        }, show)

        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (showError) {
        res.writeHead(200)
        res.end(JSON.stringify({ success: false, error: showError.message }))
      }
      return
    }

    // Run Playwright code endpoint (POST)
    if (pathname === "/runCode" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", async () => {
        try {
          const { code } = JSON.parse(body)

          // Execute code in page context where document/window are available
          const result = await currentPage.evaluate(`(async () => { ${code} })()`)

          res.writeHead(200)
          res.end(JSON.stringify({ success: true, result }))
        } catch (runError) {
          console.error("[browser-server] Run code error:", runError.message)
          res.writeHead(200)
          res.end(JSON.stringify({ success: false, error: runError.message }))
        }
      })
      return
    }

    // Verify element visible endpoint
    if (pathname === "/verifyElementVisible") {
      const role = url.searchParams.get("role")
      const accessibleName = url.searchParams.get("accessibleName")
      const selector = url.searchParams.get("selector")

      try {
        let visible = false

        if (selector) {
          const locator = currentPage.locator(selector).first()
          visible = await locator.isVisible().catch(() => false)
        } else if (role && accessibleName) {
          const locator = currentPage.getByRole(role, { name: accessibleName })
          visible = await locator.isVisible().catch(() => false)
        }

        res.writeHead(200)
        res.end(JSON.stringify({ visible }))
      } catch (verifyError) {
        res.writeHead(200)
        res.end(JSON.stringify({ visible: false, error: verifyError.message }))
      }
      return
    }

    // Verify text visible endpoint
    if (pathname === "/verifyTextVisible") {
      const text = url.searchParams.get("text")

      try {
        const locator = currentPage.getByText(text)
        const visible = await locator.isVisible().catch(() => false)

        res.writeHead(200)
        res.end(JSON.stringify({ visible }))
      } catch (verifyError) {
        res.writeHead(200)
        res.end(JSON.stringify({ visible: false, error: verifyError.message }))
      }
      return
    }

    // Generate locator endpoint
    if (pathname === "/generateLocator") {
      const element = url.searchParams.get("element")
      const ref = url.searchParams.get("ref")

      try {
        const locatorStr = await currentPage.evaluate(
          ({ selector }) => {
            const el = document.querySelector(selector)
            if (!el) return ""

            // Try different locator strategies
            if (el.id) return `#${el.id}`
            if (el.getAttribute("data-testid")) return `[data-testid="${el.getAttribute("data-testid")}"]`
            if (el.getAttribute("aria-label")) return `[aria-label="${el.getAttribute("aria-label")}"]`

            // Generate CSS path
            const path = []
            let current = el
            while (current && current !== document.body) {
              let selector = current.tagName.toLowerCase()
              if (current.id) {
                selector = `#${current.id}`
                path.unshift(selector)
                break
              }
              if (current.className && typeof current.className === "string") {
                selector += `.${current.className.split(" ").filter(Boolean).join(".")}`
              }
              path.unshift(selector)
              current = current.parentElement
            }
            return path.join(" > ")
          },
          { selector: ref || element },
        )

        res.writeHead(200)
        res.end(JSON.stringify({ locator: locatorStr }))
      } catch (locatorError) {
        res.writeHead(200)
        res.end(JSON.stringify({ locator: "", error: locatorError.message }))
      }
      return
    }

    if (pathname === "/close") {
      console.log("[browser-server] Closing browser")
      if (currentPage) await currentPage.close()
      if (context) await context.close()
      if (browser) await browser.close()

      currentPage = null
      context = null
      browser = null

      res.writeHead(200)
      res.end(JSON.stringify({ success: true }))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: "Not found" }))
  } catch (error) {
    console.error("[browser-server] Error at", req.url, ":", error.message)
    console.error("[browser-server] Stack:", error.stack)
    res.writeHead(500)
    res.end(JSON.stringify({ error: error.message, stack: error.stack }))
  }
})

async function getPageInfo() {
  if (!currentPage) return {}

  try {
    const title = await currentPage.title().catch(() => "")
    const urlStr = currentPage.url() // Synchronous in Playwright
    const viewport = currentPage.viewportSize() || { width: 1280, height: 720 } // Also synchronous

    return {
      url: urlStr,
      title,
      viewport,
      scroll: { x: 0, y: 0 },
    }
  } catch (err) {
    console.error("[browser-server] getPageInfo error:", err.message)
    return { url: "", title: "", viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 0 } }
  }
}

server.listen(PORT, () => {
  console.log(`[browser-server] Server listening on port ${PORT}`)
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("[browser-server] Shutting down...")
  if (currentPage) await currentPage.close().catch(() => {})
  if (context) await context.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  server.close(() => {
    console.log("[browser-server] Shutdown complete")
    process.exit(0)
  })
})
