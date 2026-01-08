import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Scroll the page.`

export const BrowserScrollTool = Tool.define("browser_scroll", {
  description: DESCRIPTION,
  parameters: z.object({
    direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
    amount: z.number().default(500).describe("Scroll amount in pixels"),
    to_element: z.string().optional().describe("CSS selector of element to scroll to"),
    return_content: z
      .enum(["text", "links", "inputs", "screenshot", "structured"])
      .optional()
      .describe("Return page content in specified format after scroll"),
    selector: z.string().optional().describe("CSS selector of scrollable container"),
    smooth: z.boolean().default(true).describe("Use smooth scrolling"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["scroll"],
      always: ["*"],
      metadata: { action: "scroll", direction: params.direction, amount: params.amount },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("scrolling", { direction: params.direction, amount: params.amount })

    try {
      await BrowserManager.scroll({
        direction: params.direction,
        amount: params.amount,
        toElement: params.to_element,
        selector: params.selector,
        smooth: params.smooth,
      })

      const actionDescription = params.to_element
        ? `to element "${params.to_element}"`
        : `${params.direction || "down"} by ${params.amount}px`

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

      return {
        title: `Scrolled ${actionDescription}`,
        metadata: {
          direction: params.direction,
          amount: params.amount,
          toElement: params.to_element,
        },
        output: `Scrolled ${actionDescription}${contentOutput}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("scroll failed", { error: message })
      throw new Error(`Scroll failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserScrollTool)
