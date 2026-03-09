import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Evaluate JavaScript expression on the page or an element.

Parameters:
- function (string): JavaScript function to execute. Format: '() => { /* code */ }' or '(element) => { /* code */ }' when element is provided
- element (string, optional): Human-readable element description
- ref (string, optional): Exact target element reference from the page snapshot

The function will be executed in the page context.
`

export const BrowserEvaluateTool = Tool.define("browser_evaluate", {
  description: DESCRIPTION,
  parameters: z.object({
    function: z.string().describe("JavaScript function to execute"),
    element: z.string().optional().describe("Human-readable element description"),
    ref: z.string().optional().describe("Exact target element reference from the page snapshot"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["evaluate"],
      always: ["*"],
      metadata: { action: "evaluate", hasElement: !!params.ref },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("evaluating JavaScript", { hasElement: !!params.ref })

    try {
      const result = await BrowserManager.evaluate(params.function, {
        element: params.element,
        ref: params.ref,
      })

      if (!result.success) {
        throw new Error(result.error || "Evaluate failed")
      }

      const output =
        result.result !== undefined
          ? typeof result.result === "object"
            ? JSON.stringify(result.result, null, 2)
            : String(result.result)
          : "undefined"

      return {
        title: "JavaScript executed",
        metadata: {
          hasElement: !!params.ref,
          resultType: typeof result.result,
        },
        output: `Result:\n${output}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("evaluate failed", { error: message })
      throw new Error(`Evaluate failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserEvaluateTool)
