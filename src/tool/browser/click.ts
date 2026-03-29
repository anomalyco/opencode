import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

export const BrowserClickTool = Tool.define("browser_click", {
  description: `Click on an element in the browser page. Use element references (@e1, @e2, etc.) from the accessibility snapshot to identify which element to click.

After clicking, returns an updated accessibility snapshot showing the new page state.

If the click fails (stale ref, element not found), a screenshot is automatically taken so you can see the current page state and find the correct element.

Use this tool to:
- Click buttons, links, and interactive elements
- Submit forms
- Open menus and dropdowns
- Interact with any clickable element on the page`,
  parameters: z.object({
    ref: z.string().describe("Element reference from snapshot (e.g., '@e1', '@e5'). Use references from the most recent snapshot."),
    newTab: z.boolean().optional().describe("If true, opens the clicked link in a new tab."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_click",
      patterns: [params.ref],
      always: ["*"],
      metadata: { ref: params.ref },
    })

    ctx.metadata({ title: `Clicking ${params.ref}` })

    const result = await BrowserClient.click(ctx.sessionID, params.ref, {
      newTab: params.newTab,
      abort: ctx.abort,
    })

    // If click failed, take screenshot + fresh snapshot for recovery
    if (result.exitCode !== 0) {
      const screenshotDir = path.join(Global.Path.data, "screenshots")
      await fs.mkdir(screenshotDir, { recursive: true })
      const filename = `click-fail-${Date.now()}.png`
      const filepath = path.join(screenshotDir, filename)

      await BrowserClient.screenshot(ctx.sessionID, filepath, { abort: ctx.abort })
      const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
      BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

      const fileExists = await fs.stat(filepath).then(() => true).catch(() => false)
      const attachments = fileExists
        ? [
            {
              type: "file" as const,
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              mime: "image/png",
              url: `data:image/png;base64,${(await fs.readFile(filepath)).toString("base64")}`,
              filename,
            },
          ]
        : undefined

      return {
        title: `Click failed: ${params.ref}`,
        metadata: { ref: params.ref, failed: true },
        output: `Click on ${params.ref} failed: ${result.error || result.output}\n\nThe element reference may be stale. Here is a fresh snapshot and screenshot to find the correct element.\n\n--- Fresh Page Snapshot ---\n${snapshot.output}`,
        attachments,
      }
    }

    // Get updated snapshot
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Clicked ${params.ref}`,
      metadata: { ref: params.ref },
      output: `Clicked element ${params.ref}\n\n--- Updated Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
