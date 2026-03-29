import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserStorageTool = Tool.define("browser_storage", {
  description: `Manage browser localStorage and sessionStorage. Use this to read, write, or clear stored data.

- "get": Get a value by key
- "set": Set a key-value pair
- "clear": Clear all storage

Storage persists across sessions via the browser profile (localStorage only; sessionStorage resets).`,
  parameters: z.object({
    action: z.enum(["get", "set", "clear"]).describe("Storage action."),
    key: z.string().optional().describe("Storage key (for 'get' and 'set' actions)."),
    value: z.string().optional().describe("Storage value (for 'set' action)."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Storage: ${params.action}` })

    let args: string[]
    switch (params.action) {
      case "get":
        if (!params.key) throw new Error("Key required for get")
        args = ["storage", "get", params.key]
        break
      case "set":
        if (!params.key || !params.value) throw new Error("Key and value required for set")
        args = ["storage", "set", params.key, params.value]
        break
      case "clear":
        args = ["storage", "clear"]
        break
    }

    const result = await BrowserClient.exec(ctx.sessionID, args!, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Storage ${params.action} failed: ${result.error || result.output}`)
    }

    return {
      title: `Storage: ${params.action}`,
      metadata: { action: params.action },
      output: result.output,
    }
  },
})
