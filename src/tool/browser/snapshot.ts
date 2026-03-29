import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

const MIN_USEFUL_SNAPSHOT_LENGTH = 100 // Snapshots shorter than this likely mean empty/loading page

export const BrowserSnapshotTool = Tool.define("browser_snapshot", {
  description: `Get the accessibility snapshot of the current browser page. Returns a structured tree of all elements with element references (@e1, @e2, etc.) that can be used with other browser tools (click, type, etc.).

The snapshot shows:
- Interactive elements (buttons, links, inputs) with their @ref identifiers
- Text content of the page
- Element hierarchy and relationships

If the snapshot is sparse or empty (page still loading, canvas-heavy app, etc.), a screenshot is automatically taken as fallback so you can see what's actually on screen.

Use this tool to:
- See what's currently on the page
- Find element references for interaction
- Check if a page has loaded correctly
- Understand the page structure before taking actions`,
  parameters: z.object({
    interactive: z.boolean().default(true).describe("If true (default), show only interactive elements. Set to false for full page tree."),
    compact: z.boolean().optional().describe("If true, show a more compact output."),
    selector: z.string().optional().describe("CSS selector to scope the snapshot to a specific part of the page."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: "Getting page snapshot" })

    const result = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: params.interactive,
      compact: params.compact,
      selector: params.selector,
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Snapshot failed: ${result.error || result.output}`)
    }

    BrowserState.setSnapshot(ctx.sessionID, result.output)

    // Auto-screenshot fallback: if snapshot is too sparse, take a screenshot
    // so the LLM has visual context (canvas apps, loading pages, image-heavy sites)
    const snapshotTooSparse = result.output.trim().length < MIN_USEFUL_SNAPSHOT_LENGTH

    if (snapshotTooSparse) {
      const screenshotDir = path.join(Global.Path.data, "screenshots")
      await fs.mkdir(screenshotDir, { recursive: true })
      const filename = `fallback-${Date.now()}.png`
      const filepath = path.join(screenshotDir, filename)

      const ssResult = await BrowserClient.screenshot(ctx.sessionID, filepath, { abort: ctx.abort })

      if (ssResult.exitCode === 0) {
        const fileExists = await fs.stat(filepath).then(() => true).catch(() => false)
        if (fileExists) {
          const data = await fs.readFile(filepath)
          const base64 = data.toString("base64")
          return {
            title: "Page snapshot (with screenshot fallback)",
            metadata: { interactive: params.interactive, screenshotFallback: true },
            output: `--- Page Snapshot (sparse — screenshot attached for visual context) ---\n${result.output}`,
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
      }
    }

    return {
      title: "Page snapshot",
      metadata: { interactive: params.interactive },
      output: `--- Page Snapshot ---\n${result.output}`,
    }
  },
})
