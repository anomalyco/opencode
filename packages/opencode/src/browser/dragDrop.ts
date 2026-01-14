import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserDragDropTool = Tool.define("browser_dragDrop", {
  description: "Drag an element and drop it onto another element",
  parameters: z.object({
    source: z.string().describe("Selector for element to drag"),
    target: z.string().describe("Selector for drop target"),
    delay: z.number().optional().describe("Delay between drag and drop in ms"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "drag_drop",
        source: params.source,
        target: params.target,
      },
    })

    await BrowserService.dragDrop(params.source, params.target, params.delay)

    return {
      title: `Dragged and dropped`,
      output: `Dragged ${params.source} to ${params.target}`,
      metadata: {
        source: params.source,
        target: params.target,
      },
    }
  },
})
