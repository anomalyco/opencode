import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserExtractTool = Tool.define("browser_extract", {
  description: `Extract data from the current browser page. Can extract text content, HTML, or specific attribute values from elements.

Use this tool to:
- Get the text content of a specific element
- Extract the HTML of a section of the page
- Get the current page title or URL
- Read attribute values from elements
- Scrape structured data from web pages`,
  parameters: z.object({
    ref: z.string().optional().describe("Element reference from snapshot (e.g., '@e3'). If omitted, extracts from the whole page."),
    type: z
      .enum(["text", "html", "title", "url"])
      .default("text")
      .describe("What to extract: 'text' for text content, 'html' for HTML markup, 'title' for page title, 'url' for current URL."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Extracting ${params.type}` })

    let result

    if (params.type === "title") {
      result = await BrowserClient.getTitle(ctx.sessionID, { abort: ctx.abort })
    } else if (params.type === "url") {
      result = await BrowserClient.getUrl(ctx.sessionID, { abort: ctx.abort })
    } else if (params.ref) {
      if (params.type === "html") {
        result = await BrowserClient.getHtml(ctx.sessionID, params.ref, { abort: ctx.abort })
      } else {
        result = await BrowserClient.getText(ctx.sessionID, params.ref, { abort: ctx.abort })
      }
    } else {
      // Full page text via snapshot
      result = await BrowserClient.snapshot(ctx.sessionID, { abort: ctx.abort })
    }

    if (result.exitCode !== 0) {
      throw new Error(`Extract failed: ${result.error || result.output}`)
    }

    return {
      title: `Extracted ${params.type}${params.ref ? ` from ${params.ref}` : ""}`,
      metadata: { type: params.type, ref: params.ref },
      output: result.output,
    }
  },
})
