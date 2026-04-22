import z from "zod"
import { Tool } from "../shared/tool"
import { callExa } from "./exa"

const DESCRIPTION = `- Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs
- Provides up-to-date information for current events and recent data
- Supports configurable result counts and returns the content from the most relevant websites
- Use this tool for accessing information beyond knowledge cutoff
- Searches are performed automatically within a single API call

Usage notes:
  - Supports live crawling modes: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)
  - Search types: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)
  - Configurable context length for optimal LLM integration
  - Domain filtering and advanced search options available

The current year is {{year}}. You MUST use this year when searching for recent information or current events
- Example: If the current year is 2026 and the user asks for "latest AI news", search for "AI news 2026", NOT "AI news 2025"`

const API_CONFIG = {
  DEFAULT_NUM_RESULTS: 8,
} as const

const Parameters = z.object({
  query: z.string().describe("Websearch query"),
  numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
  livecrawl: z
    .enum(["fallback", "preferred"])
    .optional()
    .describe(
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    ),
  type: z
    .enum(["auto", "fast", "deep"])
    .optional()
    .describe("Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"),
  contextMaxCharacters: z
    .number()
    .optional()
    .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
})

export const WebSearchTool = Tool.define("websearch", async () => ({
  get description() {
    return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
  },
  parameters: Parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "websearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        numResults: params.numResults,
        livecrawl: params.livecrawl,
        type: params.type,
        contextMaxCharacters: params.contextMaxCharacters,
      },
    })

    const output = await callExa({
      name: "web_search_exa",
      args: {
        query: params.query,
        type: params.type || "auto",
        numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
        livecrawl: params.livecrawl || "fallback",
        contextMaxCharacters: params.contextMaxCharacters,
      },
      timeout: 25000,
      abort: ctx.abort,
    })

    return output
      ? {
          output,
          title: `Web search: ${params.query}`,
          metadata: {},
        }
      : {
          output: "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: {},
        }
  },
}))
