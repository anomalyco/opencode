import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserCheckTool = Tool.define("browser_check", {
  description: "Check or uncheck a checkbox",
  parameters: z.object({
    selector: z.string().describe("Checkbox selector"),
    checked: z.boolean().optional().default(true).describe("Check or uncheck"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "check",
        selector: params.selector,
        checked: params.checked,
      },
    })

    await BrowserService.check(params.selector, params.checked)

    return {
      title: `${params.checked ? 'Checked' : 'Unchecked'} checkbox`,
      output: `${params.checked ? 'Checked' : 'Unchecked'}: ${params.selector}`,
      metadata: {
        selector: params.selector,
        checked: params.checked,
      },
    }
  },
})
