import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetLocalStorageTool = Tool.define("browser_setLocalStorage", {
  description: "Set a value in localStorage",
  parameters: z.object({
    key: z.string().describe("Storage key"),
    value: z.string().describe("Storage value"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_local_storage",
        key: params.key,
      },
    })

    await BrowserService.setLocalStorage(params.key, params.value)

    return {
      title: `Set localStorage`,
      output: `Set ${params.key} = ${params.value}`,
      metadata: {
        key: params.key,
        value: params.value,
      },
    }
  },
})
