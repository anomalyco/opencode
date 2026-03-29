import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserFindTool = Tool.define("browser_find", {
  description: `Find elements on the page using semantic locators instead of @ref references. This is useful when:
- You know the text/role/label of an element but not its @ref
- You want to check if an element exists
- Snapshot refs have gone stale after a page change
- You need to find elements by their ARIA role, visible text, label, placeholder, alt text, title, or test ID

Semantic locators are more reliable than @ref when the page has changed. The result includes the element's @ref for use with other tools.`,
  parameters: z.object({
    by: z.enum(["role", "text", "label", "placeholder", "alt", "title", "testid"]).describe("How to find the element."),
    value: z.string().describe("The value to search for (e.g., role='button', text='Sign In', label='Email')."),
    name: z.string().optional().describe("For role-based search, the accessible name of the element (e.g., by='role', value='button', name='Submit')."),
    action: z.enum(["click", "fill", "check", "hover", "none"]).default("none").describe("Optional action to perform on the found element. 'none' just returns the element info."),
    actionValue: z.string().optional().describe("Value for the action (e.g., text to fill)."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Finding: ${params.by}="${params.value}"` })

    const args = ["find", params.by, params.value]
    if (params.name) args.push("name", params.name)
    if (params.action && params.action !== "none") {
      args.push(params.action)
      if (params.actionValue) args.push(params.actionValue)
    }

    const result = await BrowserClient.exec(ctx.sessionID, args, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Find failed: ${result.error || result.output}`)
    }

    return {
      title: `Found: ${params.by}="${params.value}"`,
      metadata: { by: params.by, value: params.value },
      output: result.output,
    }
  },
})
