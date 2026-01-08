import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Take a screenshot of the current page.

Parameters:
- full_page (boolean, optional): Capture the full scrollable page (default: false)
- selector (string, optional): CSS selector of element to capture
- quality (number, optional): Image quality 0-100 (default: 80)
`

export const BrowserScreenshotTool = Tool.define("browser_screenshot", {
  description: DESCRIPTION,
  parameters: z.object({
    full_page: z.boolean().default(false).describe("Capture the full scrollable page"),
    selector: z.string().optional().describe("CSS selector of element to capture"),
    quality: z.number().min(0).max(100).default(80).describe("Image quality (0-100)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["screenshot"],
      always: ["*"],
      metadata: { action: "screenshot", fullPage: params.full_page, selector: params.selector },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("taking screenshot", { fullPage: params.full_page, selector: params.selector })

    try {
      const buffer = await BrowserManager.screenshot({
        fullPage: params.full_page,
        selector: params.selector,
        quality: params.quality,
      })

      const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`
      const info = await BrowserManager.getPageInfo()

      return {
        title: `Screenshot: ${info.title}`,
        metadata: {
          url: info.url,
          pageTitle: info.title,
          fullPage: params.full_page,
          selector: params.selector,
          size: dataUrl.length,
        },
        output: `Screenshot captured successfully`,
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file" as const,
            mime: "image/png",
            url: dataUrl,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("screenshot failed", { error: message })
      throw new Error(`Screenshot failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserScreenshotTool)
