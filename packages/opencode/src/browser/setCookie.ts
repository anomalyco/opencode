import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetCookieTool = Tool.define("browser_setCookie", {
  description: "Set a cookie for a domain",
  parameters: z.object({
    name: z.string().describe("Cookie name"),
    value: z.string().describe("Cookie value"),
    domain: z.string().describe("Cookie domain"),
    path: z.string().optional().default("/").describe("Cookie path"),
    secure: z.boolean().optional().default(false).describe("Secure flag"),
    httpOnly: z.boolean().optional().default(false).describe("HttpOnly flag"),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional().default("Lax").describe("SameSite value"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.domain],
      always: ["*"],
      metadata: {
        action: "set_cookie",
        name: params.name,
        domain: params.domain,
      },
    })

    await BrowserService.setCookie({
      name: params.name,
      value: params.value,
      domain: params.domain,
      path: params.path,
      secure: params.secure,
      httpOnly: params.httpOnly,
      sameSite: params.sameSite,
    })

    return {
      title: `Set cookie`,
      output: `Set cookie "${params.name}" for ${params.domain}`,
      metadata: {
        name: params.name,
        domain: params.domain,
      },
    }
  },
})
