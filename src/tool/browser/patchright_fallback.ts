import z from "zod"
import { Tool } from "../tool"
import { PatchrightLauncher } from "../../browser/patchright"
import { BrowserState } from "../../browser/state"
import { BrowserClient } from "../../browser/client"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

/**
 * Patchright fallback tool — stealth direct browser control for when
 * agent-browser can't handle something (complex iframes, shadow DOM,
 * closed shadow roots, anti-bot pages, stale refs).
 *
 * Patchright is an undetected Playwright fork that bypasses bot detection.
 * After the action, a fresh agent-browser snapshot is taken so the
 * LLM can continue with @ref-based tools.
 */
export const PatchrightFallbackTool = Tool.define("browser_patchright", {
  description: `Stealth Patchright browser control — use this as a FALLBACK when agent-browser tools fail, especially for:

- Iframes that agent-browser can't access (even after browser_frame)
- Elements that keep returning stale @ref errors
- Shadow DOM / closed shadow root elements
- Anti-bot protected pages that block agent-browser
- Complex CSS selectors that agent-browser's @ref system can't target
- When you need to interact with a specific iframe by URL or name

Patchright is a stealth browser that bypasses anti-bot detection. After the action completes, a fresh agent-browser snapshot is taken so you can continue using @ref-based tools.

Available actions:
- "click": Click element by CSS selector
- "fill": Fill text into element by CSS selector
- "goto": Navigate to URL
- "eval": Run JavaScript
- "screenshot": Take screenshot
- "content": Get full page HTML
- "frame_click": Click inside a specific iframe
- "frame_fill": Type inside a specific iframe
- "frame_content": Get content from a specific iframe
- "wait_selector": Wait for a CSS selector to appear
- "wait_navigation": Wait for page navigation`,
  parameters: z.object({
    action: z.enum([
      "click", "fill", "goto", "eval", "screenshot", "content",
      "frame_click", "frame_fill", "frame_content",
      "wait_selector", "wait_navigation",
    ]).describe("Action to perform."),
    selector: z.string().optional().describe("CSS selector for click/fill/wait_selector actions."),
    text: z.string().optional().describe("Text for fill action, or JavaScript for eval action."),
    url: z.string().optional().describe("URL for goto action."),
    frameSelector: z.string().optional().describe("Frame name, URL pattern, or CSS selector to identify the iframe (for frame_* actions)."),
  }),
  async execute(params, ctx) {
    if (!PatchrightLauncher.isRunning()) {
      throw new Error("Chrome is not running. Use browser_open first to start a session.")
    }

    await ctx.ask({
      permission: "browser_patchright",
      patterns: [params.action],
      always: ["screenshot", "content", "wait_selector", "wait_navigation"],
      metadata: { action: params.action, selector: params.selector },
    })

    ctx.metadata({ title: `Patchright: ${params.action}` })

    const page = PatchrightLauncher.getPage()
    if (!page) throw new Error("No active page")

    let result = ""

    switch (params.action) {
      case "click":
        if (!params.selector) throw new Error("selector required for click")
        await page.click(params.selector)
        result = `Clicked ${params.selector}`
        break

      case "fill":
        if (!params.selector) throw new Error("selector required for fill")
        if (!params.text) throw new Error("text required for fill")
        await page.fill(params.selector, params.text)
        result = `Filled ${params.selector} with "${params.text.slice(0, 50)}"`
        break

      case "goto":
        if (!params.url) throw new Error("url required for goto")
        await page.goto(params.url, { waitUntil: "domcontentloaded" })
        result = `Navigated to ${params.url}`
        break

      case "eval":
        if (!params.text) throw new Error("text (JavaScript code) required for eval")
        const evalResult = await page.evaluate(params.text)
        result = `Result: ${JSON.stringify(evalResult)}`
        break

      case "screenshot": {
        const screenshotDir = path.join(Global.Path.data, "screenshots")
        await fs.mkdir(screenshotDir, { recursive: true })
        const filename = `pr-${Date.now()}.png`
        const filepath = path.join(screenshotDir, filename)
        await page.screenshot({ path: filepath })
        const data = await fs.readFile(filepath)
        const base64 = data.toString("base64")
        return {
          title: "Patchright screenshot",
          metadata: { action: "screenshot" },
          output: `Screenshot captured via Patchright (stealth)`,
          attachments: [{
            type: "file" as const,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            mime: "image/png",
            url: `data:image/png;base64,${base64}`,
            filename,
          }],
        }
      }

      case "content":
        result = await page.content()
        if (result.length > 10000) result = result.slice(0, 10000) + "\n... (truncated)"
        break

      case "frame_click": {
        if (!params.frameSelector) throw new Error("frameSelector required")
        if (!params.selector) throw new Error("selector required")
        const frame = page.frame(params.frameSelector) ||
          page.frame({ url: new RegExp(params.frameSelector) })
        if (!frame) throw new Error(`Frame not found: ${params.frameSelector}`)
        await frame.click(params.selector)
        result = `Clicked ${params.selector} inside frame ${params.frameSelector}`
        break
      }

      case "frame_fill": {
        if (!params.frameSelector) throw new Error("frameSelector required")
        if (!params.selector) throw new Error("selector required")
        if (!params.text) throw new Error("text required")
        const frame = page.frame(params.frameSelector) ||
          page.frame({ url: new RegExp(params.frameSelector) })
        if (!frame) throw new Error(`Frame not found: ${params.frameSelector}`)
        await frame.fill(params.selector, params.text)
        result = `Filled ${params.selector} inside frame ${params.frameSelector}`
        break
      }

      case "frame_content": {
        if (!params.frameSelector) throw new Error("frameSelector required")
        const frame = page.frame(params.frameSelector) ||
          page.frame({ url: new RegExp(params.frameSelector) })
        if (!frame) throw new Error(`Frame not found: ${params.frameSelector}`)
        result = await frame.content()
        if (result.length > 10000) result = result.slice(0, 10000) + "\n... (truncated)"
        break
      }

      case "wait_selector":
        if (!params.selector) throw new Error("selector required")
        await page.waitForSelector(params.selector, { timeout: 30000 })
        result = `Element ${params.selector} appeared`
        break

      case "wait_navigation":
        await page.waitForNavigation({ timeout: 30000 })
        result = `Navigation completed`
        break
    }

    // After Patchright action, take a fresh agent-browser snapshot
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    }).catch(() => ({ output: "(snapshot unavailable after patchright action)" }))

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Patchright: ${params.action}`,
      metadata: { action: params.action },
      output: `${result}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
