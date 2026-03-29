import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserCookiesTool = Tool.define("browser_cookies", {
  description: `Manage browser cookies. Use this to read, set, or clear cookies for the current page.

- "get": Get all cookies for the current domain
- "set": Set a cookie with name and value
- "clear": Clear all cookies

Cookies persist across sessions via the browser profile.`,
  parameters: z.object({
    action: z.enum(["get", "set", "clear"]).describe("Cookie action."),
    name: z.string().optional().describe("Cookie name (for 'set' action)."),
    value: z.string().optional().describe("Cookie value (for 'set' action)."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Cookies: ${params.action}` })

    let args: string[]
    switch (params.action) {
      case "get":
        args = ["cookies", "get"]
        break
      case "set":
        if (!params.name || !params.value) throw new Error("Name and value required for set")
        args = ["cookies", "set", params.name, params.value]
        break
      case "clear":
        args = ["cookies", "clear"]
        break
    }

    const result = await BrowserClient.exec(ctx.sessionID, args!, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Cookies ${params.action} failed: ${result.error || result.output}`)
    }

    return {
      title: `Cookies: ${params.action}`,
      metadata: { action: params.action },
      output: result.output,
    }
  },
})
