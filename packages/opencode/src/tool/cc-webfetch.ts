import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-webfetch.txt"
import { WebFetchTool } from "./webfetch"

/**
 * cc_webfetch - Anthropic-native web fetching tool
 *
 * This is a wrapper around the standard webfetch tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * web fetching capabilities.
 */
export const ClaudeCodeWebFetchTool = Tool.define("cc_webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .describe("The format to return the content in (text, markdown, or html)"),
    timeout: z.number().optional().describe("Optional timeout in seconds (max 120)"),
  }),
  async execute(params, ctx) {
    // Delegate to the standard webfetch tool
    const webfetchTool = await WebFetchTool.init()
    return webfetchTool.execute(params, ctx)
  },
})
