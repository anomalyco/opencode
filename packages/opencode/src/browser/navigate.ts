import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService, BrowserError } from "./index"

export const BrowserNavigateTool = Tool.define("browser_navigate", {
  description: "Navigate to a URL in the current tab",
  parameters: z.object({
    url: z.string().describe("The URL to navigate to (must start with http:// or https://)"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .default("domcontentloaded")
      .describe("When to consider navigation complete"),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    await ctx.ask({
      permission: "browser",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        action: "navigate",
      },
    })

    const result = await BrowserService.navigate(params.url)

    return {
      title: `Navigated to ${result.url}`,
      output: `Successfully navigated to ${result.url}\nTitle: ${result.title}`,
      metadata: {},
    }
  },
})
