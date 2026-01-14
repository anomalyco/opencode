import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetLocalStorageTool = Tool.define("browser_getLocalStorage", {
  description: "Get a value from localStorage, or all values",
  parameters: z.object({
    key: z.string().optional().describe("Key to get (default: all)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_local_storage",
        key: params.key,
      },
    })

    const result = await BrowserService.getLocalStorage(params.key)

    return {
      title: params.key ? `Got localStorage: ${params.key}` : `Got all localStorage`,
      output: params.key 
        ? `${params.key} = ${result.value}`
        : `${Object.keys(result.all).length} items in localStorage`,
      metadata: params.key
        ? { key: params.key, value: result.value }
        : { all: result.all, count: Object.keys(result.all).length },
    }
  },
})
