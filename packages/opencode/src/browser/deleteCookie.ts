import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserDeleteCookieTool = Tool.define("browser_deleteCookie", {
  description: "Delete a cookie by name",
  parameters: z.object({
    name: z.string().describe("Cookie name to delete"),
    domain: z.string().optional().describe("Cookie domain"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "delete_cookie",
        name: params.name,
      },
    })

    await BrowserService.deleteCookie(params.name, params.domain)

    return {
      title: `Deleted cookie`,
      output: `Deleted cookie "${params.name}"`,
      metadata: {
        name: params.name,
      },
    }
  },
})
