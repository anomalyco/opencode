import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Find elements matching query. Returns selector, text, and bounds.`

export const BrowserSearchTool = Tool.define("browser_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Element description to search for (e.g., 'search input', 'submit button')"),
    limit: z.number().default(5).describe("Max results to return"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.query],
      always: ["*"],
      metadata: { action: "search", query: params.query },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("searching elements", { query: params.query })

    try {
      const results = await BrowserManager.searchElements({ text: params.query })
      const limited = results.slice(0, params.limit)

      if (limited.length === 0) {
        return {
          title: `No elements found for: ${params.query}`,
          metadata: { query: params.query, found: 0 },
          output: `No matching elements found. Try a different description.`,
        }
      }

      const formatted = limited.map((el) => ({
        index: el.index,
        selector: el.selector,
        text: el.text.slice(0, 50),
        type: el.tagName,
        bounds: el.bounds,
      }))

      return {
        title: `Found ${limited.length} matching element(s)`,
        metadata: { query: params.query, found: limited.length },
        output: `Found ${limited.length} element(s). Top match: ${formatted[0].selector} (${formatted[0].text})`,
        details: formatted,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("search failed", { error: message })
      throw new Error(`Search failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserSearchTool)
