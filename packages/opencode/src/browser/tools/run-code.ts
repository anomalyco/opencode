import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Run custom JavaScript/TypeScript code in the browser page context.

Executes arbitrary code with access to DOM, window, document, etc.
Returns the result of the last expression.

Parameters:
- code (string, required): JavaScript/TypeScript code to execute
- timeout (number, optional): Maximum execution time in milliseconds (default: 30000)

Example:
- code: "document.querySelectorAll('a').length" returns the number of links
- code: "window.innerWidth" returns the viewport width
- code: "localStorage.getItem('key')" reads from localStorage
`

export const BrowserRunCodeTool = Tool.define("browser_run_code", {
  description: DESCRIPTION,
  parameters: z.object({
    code: z.string().describe("JavaScript/TypeScript code to execute"),
    timeout: z.number().default(30000).describe("Maximum execution time in milliseconds"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["run_code"],
      always: ["*"],
      metadata: { action: "run_code", codeLength: params.code.length },
    })

    log.info("running code", { codeLength: params.code.length, timeout: params.timeout })

    try {
      const response = await BrowserManager.runCode(params.code)

      if (!response.success) {
        throw new Error(response.error || "Unknown error")
      }

      const result = response.result
      let output: string
      if (result === undefined) {
        output = "(undefined)"
      } else if (result === null) {
        output = "(null)"
      } else if (typeof result === "object") {
        output = JSON.stringify(result, null, 2)
      } else {
        output = String(result)
      }

      return {
        title: "Code executed",
        metadata: { resultType: typeof result },
        output: output,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("run code failed", { error: message })
      throw new Error(`Code execution failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserRunCodeTool)
