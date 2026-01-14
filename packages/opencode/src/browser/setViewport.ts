import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetViewportTool = Tool.define("browser_setViewport", {
  description: "Set the browser viewport size",
  parameters: z.object({
    width: z.number().describe("Viewport width in pixels"),
    height: z.number().describe("Viewport height in pixels"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_viewport",
        width: params.width,
        height: params.height,
      },
    })

    await BrowserService.setViewport(params.width, params.height)

    return {
      title: `Viewport set`,
      output: `Viewport set to ${params.width}x${params.height}`,
      metadata: {
        width: params.width,
        height: params.height,
      },
    }
  },
})
