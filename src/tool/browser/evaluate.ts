import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserEvaluateTool = Tool.define("browser_evaluate", {
  description: `Execute JavaScript code in the browser page context. Returns the result of the expression.

Use this tool to:
- Query DOM elements or page state programmatically
- Execute custom logic on the page
- Access JavaScript APIs or page variables
- Perform complex data extraction that can't be done with other tools
- Interact with page JavaScript frameworks`,
  parameters: z.object({
    javascript: z.string().describe("JavaScript code to execute in the page context. The return value of the last expression will be returned."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_evaluate",
      patterns: [],
      always: ["*"],
      metadata: { javascript: params.javascript.slice(0, 200) },
    })

    ctx.metadata({ title: "Executing JavaScript" })

    const result = await BrowserClient.evaluate(ctx.sessionID, params.javascript, {
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`JavaScript execution failed: ${result.error || result.output}`)
    }

    return {
      title: "JavaScript executed",
      metadata: { codeLength: params.javascript.length },
      output: `Result: ${result.output}`,
    }
  },
})
