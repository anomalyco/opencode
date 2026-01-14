import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserEvaluateTool = Tool.define("browser_evaluate", {
  description: "Execute JavaScript code in the browser context",
  parameters: z.object({
    script: z.string().describe("JavaScript code to execute in the page context"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        script: params.script.substring(0, 100),
        action: "evaluate",
      },
    })

    const result = await BrowserService.evaluate(params.script)

    let output = "Script executed successfully"
    if (result.console.length > 0) {
      output += "\n\nConsole output:"
      for (const msg of result.console) {
        output += `\n[${msg.type}] ${msg.text}`
      }
    }

    return {
      title: "Script executed",
      output,
      metadata: {
        result: result.result,
        console: result.console,
      },
    }
  },
})
