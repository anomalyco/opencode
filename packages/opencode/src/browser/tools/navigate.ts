import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Navigate to a URL.

Parameters:
- url (string): The URL to navigate to
- wait_until (string, optional): Wait condition before returning (load, domcontentloaded, networkidle, commit)
- return_content (string, optional): Return page content in specified format after navigation, use this to get page text, links, inputs, screenshot, or structured data faster
- timeout (number, optional): Timeout in milliseconds
`

export const BrowserNavigateTool = Tool.define("browser_navigate", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to navigate to"),
    wait_until: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .default("domcontentloaded")
      .describe("Wait condition before returning"),
    return_content: z
      .enum(["text", "links", "inputs", "screenshot", "structured"])
      .optional()
      .describe("Return page content in specified format after navigation"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute(params, ctx) {
    const rawUrl = params.url.trim()
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

    await ctx.ask({
      permission: "browser",
      patterns: [url],
      always: ["*"],
      metadata: { action: "navigate", url },
    })

    log.info("navigating to URL", { url })

    try {
      if (!BrowserManager.isReady()) {
        await BrowserManager.init({ headed: true })
      }

      await BrowserManager.navigate(url, {
        waitUntil: params.wait_until,
        timeout: params.timeout,
      })

      const info = await BrowserManager.getPageInfo()
      let contentOutput = ""

      if (params.return_content) {
        switch (params.return_content) {
          case "text": {
            const result = await BrowserManager.getContent()
            contentOutput = `\n\nPage text:\n${result.text.slice(0, 500)}...`
            break
          }
          case "links": {
            const elements = await BrowserManager.getInteractiveElements({ type: "clickable" })
            const links = elements.filter((e) => e.tagName === "a").slice(0, 5)
            contentOutput = `\n\nFound ${links.length} links:\n${links.map((e) => `- ${e.text}`).join("\n")}`
            break
          }
          case "inputs": {
            const elements = await BrowserManager.getInteractiveElements({ type: "input" })
            contentOutput = `\n\nFound ${elements.length} inputs:\n${elements
              .slice(0, 5)
              .map((e) => `- ${e.type}: ${e.placeholder || e.text}`)
              .join("\n")}`
            break
          }
          case "screenshot": {
            await BrowserManager.screenshot()
            contentOutput = `\n\nScreenshot taken`
            break
          }
          case "structured": {
            const result = await BrowserManager.snapshot()
            const elementCount = Object.keys(result.elementMap).length
            contentOutput = `\n\nPage has ${elementCount} interactive elements`
            break
          }
        }
      }

      log.info("navigation completed", { url: info.url, title: info.title })

      return {
        title: `Navigated to: ${info.title}`,
        metadata: { url: info.url, pageTitle: info.title, status: "success" },
        output: `Successfully navigated to ${info.url}\nPage title: ${info.title}${contentOutput}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("navigation failed", { error: message })
      return {
        title: `Navigation failed`,
        metadata: { url, pageTitle: "", status: "failed" },
        output: `Failed to navigate to ${url}: ${message}`,
      }
    }
  },
})

Tool.attachExecute(BrowserNavigateTool)
