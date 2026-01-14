import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSelectTool = Tool.define("browser_select", {
  description: "Select an option in a dropdown select element",
  parameters: z.object({
    selector: z.string().describe("Select element selector"),
    value: z.string().describe("Option value to select"),
    label: z.string().optional().describe("Option label to select (alternative to value)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "select",
        selector: params.selector,
        value: params.value,
      },
    })

    const result = await BrowserService.select(params.selector, params.value, params.label)

    return {
      title: `Selected option`,
      output: `Selected option "${result.selectedLabel || result.value}" in ${params.selector}`,
      metadata: {
        value: result.value,
        label: result.selectedLabel,
      },
    }
  },
})
