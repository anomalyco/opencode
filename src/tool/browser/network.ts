import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserNetworkTool = Tool.define("browser_network", {
  description: `Control and monitor network requests in the browser. Use this to:

- Block unwanted requests (ads, trackers, analytics)
- Mock API responses for testing
- View all network requests made by the page
- Record HAR files for debugging

Actions:
- "block": Block requests matching a URL pattern
- "mock": Return mock JSON for requests matching a URL pattern
- "unblock": Remove a routing rule
- "requests": View tracked network requests
- "har_start": Start recording a HAR file
- "har_stop": Stop recording and save HAR file`,
  parameters: z.object({
    action: z.enum(["block", "mock", "unblock", "requests", "har_start", "har_stop"]).describe("Network action to take."),
    pattern: z.string().optional().describe("URL pattern to match (e.g., '**/analytics/**', 'api.example.com/*'). Required for block/mock/unblock."),
    mockResponse: z.string().optional().describe("JSON string to return as mock response. Required for 'mock' action."),
    outputFile: z.string().optional().describe("Output file path for har_stop action."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_network",
      patterns: [params.action],
      always: ["requests", "har_start", "har_stop"],
      metadata: { action: params.action, pattern: params.pattern },
    })

    ctx.metadata({ title: `Network: ${params.action}` })

    let args: string[]
    switch (params.action) {
      case "block":
        if (!params.pattern) throw new Error("Pattern required for block action")
        args = ["network", "route", params.pattern, "abort"]
        break
      case "mock":
        if (!params.pattern) throw new Error("Pattern required for mock action")
        if (!params.mockResponse) throw new Error("mockResponse required for mock action")
        args = ["network", "route", params.pattern, "mock", params.mockResponse]
        break
      case "unblock":
        args = ["network", "route", "remove"]
        break
      case "requests":
        args = ["network", "requests"]
        break
      case "har_start":
        args = ["network", "har", "start"]
        break
      case "har_stop":
        args = ["network", "har", "stop"]
        if (params.outputFile) args.push(params.outputFile)
        break
    }

    const result = await BrowserClient.exec(ctx.sessionID, args!, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Network ${params.action} failed: ${result.error || result.output}`)
    }

    return {
      title: `Network: ${params.action}`,
      metadata: { action: params.action },
      output: result.output,
    }
  },
})
