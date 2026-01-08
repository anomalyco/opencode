import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Wait for various page conditions.

Parameters:
- time (number, optional): Time to wait in seconds
- text (string, optional): Text to wait for to appear
- textGone (string, optional): Text to wait for to disappear
- selector (string, optional): CSS selector to wait for
- visible (boolean, optional): Wait for element to be visible
- timeout (number, optional): Maximum wait time in milliseconds (default: 30000)
`

export const BrowserWaitTool = Tool.define("browser_wait", {
  description: DESCRIPTION,
  parameters: z.object({
    time: z.number().optional().describe("Time to wait in seconds"),
    text: z.string().optional().describe("Text to wait for to appear"),
    textGone: z.string().optional().describe("Text to wait for to disappear"),
    selector: z.string().optional().describe("CSS selector to wait for"),
    visible: z.boolean().default(false).describe("Wait for element to be visible"),
    timeout: z.number().default(30000).describe("Maximum wait time in milliseconds"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["wait"],
      always: ["*"],
      metadata: { action: "wait", time: params.time, text: params.text, selector: params.selector },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("waiting", { time: params.time, text: params.text, selector: params.selector })

    try {
      const startTime = Date.now()

      // If time is specified, use setTimeout
      if (params.time) {
        await new Promise((resolve) => setTimeout(resolve, params.time! * 1000))
      } else {
        await BrowserManager.wait({
          selector: params.selector,
          visible: params.visible,
          timeout: params.timeout,
        })
      }

      const elapsed = Date.now() - startTime
      const waitedFor = params.time ? `${params.time}s` : params.text || params.textGone || params.selector

      return {
        title: `Waited for: ${waitedFor}`,
        metadata: {
          time: params.time,
          text: params.text,
          textGone: params.textGone,
          selector: params.selector,
          elapsed,
        },
        output: params.time
          ? `Waited for ${params.time} seconds`
          : params.text
            ? `Text "${params.text}" appeared (${elapsed}ms)`
            : params.textGone
              ? `Text "${params.textGone}" disappeared (${elapsed}ms)`
              : `Element "${params.selector}" appeared (${elapsed}ms)`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("wait failed", { error: message })
      throw new Error(`Wait failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserWaitTool)
