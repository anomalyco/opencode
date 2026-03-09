import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Get network requests made by the browser page.

Returns captured HTTP requests including URLs, methods, status codes, and timing.
Useful for debugging API calls, verifying data fetching, and monitoring network activity.

Parameters:
- type (string, optional): Filter by request type (xhr, fetch, document, stylesheet, script, image, font, other)
- status (number, optional): Filter by HTTP status code
- url_pattern (string, optional): Filter by URL pattern (substring match)
- limit (number, optional): Maximum number of requests to return (default: 50)
`

export const BrowserNetworkRequestsTool = Tool.define("browser_network_requests", {
  description: DESCRIPTION,
  parameters: z.object({
    type: z
      .enum(["xhr", "fetch", "document", "stylesheet", "script", "image", "font", "other"])
      .optional()
      .describe("Filter by request type"),
    status: z.number().optional().describe("Filter by HTTP status code"),
    url_pattern: z.string().optional().describe("Filter by URL pattern (substring match)"),
    limit: z.number().default(50).describe("Maximum number of requests to return"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["network_requests"],
      always: ["*"],
      metadata: { action: "network_requests" },
    })

    log.info("getting network requests", { type: params.type, limit: params.limit })

    try {
      const requests = await BrowserManager.getNetworkRequests()

      let filtered = requests
      if (params.type) {
        filtered = filtered.filter((r: any) => r.resourceType === params.type)
      }
      if (params.status !== undefined) {
        filtered = filtered.filter((r: any) => r.status === params.status)
      }
      if (params.url_pattern) {
        filtered = filtered.filter((r: any) => r.url.includes(params.url_pattern))
      }

      const limited = filtered.slice(0, params.limit)

      if (limited.length === 0) {
        return {
          title: "Network requests",
          metadata: { count: 0, total: 0 },
          output: "No matching network requests found",
        }
      }

      const formatted = limited
        .map((r: any, i: number) => {
          const parts = [
            `[${i + 1}] ${r.method} ${r.url}`,
            `    Status: ${r.status || "pending"}`,
            r.resourceType ? `    Type: ${r.resourceType}` : null,
            r.timing ? `    Duration: ${r.timing}ms` : null,
          ].filter(Boolean)
          return parts.join("\n")
        })
        .join("\n\n")

      return {
        title: "Network requests",
        metadata: { count: limited.length, total: requests.length },
        output: formatted,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("get network requests failed", { error: message })
      throw new Error(`Failed to get network requests: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserNetworkRequestsTool)
