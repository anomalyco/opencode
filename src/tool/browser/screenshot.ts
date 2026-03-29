import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

export const BrowserScreenshotTool = Tool.define("browser_screenshot", {
  description: `Take a screenshot of the current browser page. The screenshot is saved to the agent's data directory and returned as an image attachment.

Use this tool to:
- Verify the visual state of a page
- Capture the result of browser actions
- Document the current state for the user
- Debug issues with page rendering or layout`,
  parameters: z.object({
    fullPage: z.boolean().optional().describe("If true, captures the entire scrollable page. Default captures only the visible viewport."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_screenshot",
      patterns: [],
      always: ["*"],
      metadata: { fullPage: params.fullPage },
    })

    const screenshotDir = path.join(Global.Path.data, "screenshots")
    await fs.mkdir(screenshotDir, { recursive: true })

    const filename = `screenshot-${Date.now()}.png`
    const filepath = path.join(screenshotDir, filename)

    ctx.metadata({ title: "Taking screenshot" })

    const result = await BrowserClient.screenshot(ctx.sessionID, filepath, {
      fullPage: params.fullPage,
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Screenshot failed: ${result.error || result.output}`)
    }

    // Read the screenshot file and return as attachment
    const fileExists = await fs.stat(filepath).then(() => true).catch(() => false)

    if (fileExists) {
      const data = await fs.readFile(filepath)
      const base64 = data.toString("base64")

      return {
        title: "Screenshot captured",
        metadata: { filepath, fullPage: params.fullPage },
        output: `Screenshot saved to ${filepath}`,
        attachments: [
          {
            type: "file" as const,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            mime: "image/png",
            url: `data:image/png;base64,${base64}`,
            filename,
          },
        ],
      }
    }

    return {
      title: "Screenshot captured",
      metadata: { filepath, fullPage: params.fullPage },
      output: `Screenshot command completed. Output: ${result.output}`,
    }
  },
})
