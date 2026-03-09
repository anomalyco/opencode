import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Perform drag and drop between two elements.

Parameters:
- startElement (string): Human-readable source element description
- startRef (string): Exact source element reference from the page snapshot
- endElement (string): Human-readable target element description
- endRef (string): Exact target element reference from the page snapshot

The cursor will visually animate during the drag operation.
`

export const BrowserDragTool = Tool.define("browser_drag", {
  description: DESCRIPTION,
  parameters: z.object({
    startElement: z.string().describe("Human-readable source element description"),
    startRef: z.string().describe("Exact source element reference from the page snapshot"),
    endElement: z.string().describe("Human-readable target element description"),
    endRef: z.string().describe("Exact target element reference from the page snapshot"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.startRef, params.endRef],
      always: ["*"],
      metadata: {
        action: "drag",
        startElement: params.startElement,
        endElement: params.endElement,
      },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("dragging", { from: params.startElement, to: params.endElement })

    try {
      const result = await BrowserManager.drag({
        startElement: params.startElement,
        startRef: params.startRef,
        endElement: params.endElement,
        endRef: params.endRef,
      })

      if (!result.success) {
        throw new Error(result.error || "Drag failed")
      }

      return {
        title: `Dragged: ${params.startElement} → ${params.endElement}`,
        metadata: {
          startElement: params.startElement,
          startRef: params.startRef,
          endElement: params.endElement,
          endRef: params.endRef,
        },
        output: `Successfully dragged "${params.startElement}" to "${params.endElement}"`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("drag failed", { error: message })
      throw new Error(`Drag failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserDragTool)
