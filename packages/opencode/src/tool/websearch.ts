import z from "zod/v4"
import { Tool } from "./tool"
import { parseHTML } from "linkedom"
import Exa from "exa-js"
import DESCRIPTION from "./websearch.txt"
import { Config } from "../config/config"
import { Permission } from "../permission"

// Cache for search results (15 minute TTL)
const searchCache = new Map<
  string,
  {
    results: SearchResult[]
    timestamp: number
    query: string
    engine: string
  }
>()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

export const WebSearchTool = Tool.define("websearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("The search query to use"),
    search_type: z
      .enum(["keyword", "neural", "auto"])
      .optional()
      .describe("Search type: keyword (DuckDuckGo), neural (Exa AI semantic search), or auto (tries neural first)"),
    category: z
      .enum(["company", "research_paper", "news", "pdf", "github", "general"])
      .optional()
      .describe("Category filter for search results"),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe("Only include search results from these domains"),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe("Never include search results from these domains"),
    max_results: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of results to return (1-100, default 10)"),
    date_filter: z
      .enum(["day", "week", "month", "year", "all"])
      .optional()
      .describe("Filter results by date"),
  }),
  async execute(params, ctx) {
    const cfg = await Config.get()
    if (cfg.permission?.websearch === "ask")
      await Permission.ask({
        type: "websearch",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: "Search the web for: " + params.query,
        metadata: {
          query: params.query,
          search_type: params.search_type,
          category: params.category,
        },
      })

    // Build cache key
    const cacheKey = JSON.stringify({
      query: params.query,
      search_type: params.search_type,
      category: params.category,
      date_filter: params.date_filter,
    })

    // Check cache
    const cached = searchCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const filtered = filterResults(cached.results, params.allowed_domains, params.blocked_domains)
      const maxResults = params.max_results || 10
      const results = filtered.slice(0, maxResults)

      return {
        title: `Web search results for: ${params.query}`,
        output: formatResults(results, params.query),
        metadata: {
          query: params.query,
          result_count: results.length,
          cached: true,
          truncated: filtered.length > maxResults,
          search_engine: cached.engine,
          timestamp: cached.timestamp,
        },
      }
    }

    const searchType = params.search_type || "auto"
    let results: SearchResult[] = []
    let engine = "duckduckgo"

    // Try neural search first if auto or neural
    if ((searchType === "auto" || searchType === "neural") && process.env["EXA_API_KEY"]) {
      try {
        results = await searchWithExa(params)
        engine = "exa"
      } catch (err) {
        // Fall back to DuckDuckGo if Exa fails
        if (searchType === "neural") {
          throw new Error(`Neural search failed: ${err}. Please set EXA_API_KEY environment variable.`)
        }
        results = await searchWithDuckDuckGo(params, ctx)
      }
    } else {
      // Use DuckDuckGo for keyword search or if no API key
      results = await searchWithDuckDuckGo(params, ctx)
    }

    // Cache results
    searchCache.set(cacheKey, {
      results,
      timestamp: Date.now(),
      query: params.query,
      engine,
    })

    // Clean old cache entries
    cleanCache()

    // Apply filtering
    const filtered = filterResults(results, params.allowed_domains, params.blocked_domains)
    const maxResults = params.max_results || 10
    const finalResults = filtered.slice(0, maxResults)

    return {
      title: `Web search results for: ${params.query}`,
      output: formatResults(finalResults, params.query),
      metadata: {
        query: params.query,
        result_count: finalResults.length,
        cached: false,
        truncated: filtered.length > maxResults,
        search_engine: engine,
        timestamp: Date.now(),
      },
    }
  },
})

interface SearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

interface SearchParams {
  query: string
  category?: string
  date_filter?: string
  max_results?: number
}

async function searchWithExa(params: SearchParams): Promise<SearchResult[]> {
  const exa = new Exa(process.env["EXA_API_KEY"]!)
  const maxResults = Math.min(params.max_results || 10, 100)

  // Build Exa-specific options
  const options: any = {
    numResults: maxResults,
    useAutoprompt: true,
    text: { maxCharacters: 500 },
  }

  // Add category filter
  if (params.category === "research_paper") {
    options.category = "research paper"
  } else if (params.category === "news") {
    options.category = "news"
  } else if (params.category === "github") {
    options.includeDomains = ["github.com"]
  } else if (params.category === "company") {
    options.category = "company"
  } else if (params.category === "pdf") {
    options.category = "pdf"
  }

  // Add date filter
  if (params.date_filter && params.date_filter !== "all") {
    const now = new Date()
    const dateMap = {
      day: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      year: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
    }
    options.startPublishedDate = dateMap[params.date_filter as keyof typeof dateMap]?.toISOString()
  }

  const response = await exa.searchAndContents(params.query, options)

  return response.results.map((result: any) => ({
    title: result.title || "",
    url: result.url || "",
    snippet: result.text || result.summary || "",
    publishedDate: result.publishedDate,
  }))
}

async function searchWithDuckDuckGo(params: SearchParams, ctx: any): Promise<SearchResult[]> {
  // Build the search URL with category filters
  let searchQuery = params.query

  // Add category-specific filters
  if (params.category === "github") {
    searchQuery += " site:github.com"
  } else if (params.category === "research_paper") {
    searchQuery += " (site:arxiv.org OR site:scholar.google.com OR filetype:pdf)"
  } else if (params.category === "news") {
    searchQuery += " (site:news.ycombinator.com OR site:techcrunch.com OR site:reuters.com)"
  } else if (params.category === "pdf") {
    searchQuery += " filetype:pdf"
  } else if (params.category === "company") {
    searchQuery += " (site:linkedin.com OR site:crunchbase.com)"
  }

  const encodedQuery = encodeURIComponent(searchQuery)
  let searchURL = `https://html.duckduckgo.com/html/?q=${encodedQuery}`

  // Add date filter
  if (params.date_filter) {
    const dateMap = { day: "d", week: "w", month: "m", year: "y", all: "" }
    const filterCode = dateMap[params.date_filter as keyof typeof dateMap]
    if (filterCode) {
      searchURL += `&df=${filterCode}`
    }
  }

  // Fetch search results
  const response = await fetch(searchURL, {
    signal: ctx?.abort,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  })

  if (!response.ok) {
    throw new Error(`Search request failed with status code: ${response.status}`)
  }

  const html = await response.text()
  return parseSearchResults(html)
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = []

  try {
    const { document } = parseHTML(html)
    const resultElements = document.querySelectorAll(".result")

    for (const element of resultElements) {
      try {
        const titleLink = element.querySelector(".result__a")
        if (!titleLink) continue

        const url = titleLink.getAttribute("href")
        const title = titleLink.textContent?.trim()
        const snippetElement = element.querySelector(".result__snippet")
        const snippet = snippetElement?.textContent?.trim()

        if (url && title) {
          results.push({
            title,
            url: decodeURIComponent(url),
            snippet: snippet || "",
          })
        }
      } catch {
        continue
      }
    }
  } catch (err) {
    throw new Error(`Failed to parse search results: ${err}`)
  }

  return results
}

function filterResults(
  results: SearchResult[],
  allowedDomains?: string[],
  blockedDomains?: string[],
): SearchResult[] {
  return results.filter((result) => {
    if (allowedDomains && allowedDomains.length > 0) {
      const isAllowed = allowedDomains.some((domain) => result.url.includes(domain))
      if (!isAllowed) return false
    }

    if (blockedDomains && blockedDomains.length > 0) {
      const isBlocked = blockedDomains.some((domain) => result.url.includes(domain))
      if (isBlocked) return false
    }

    return true
  })
}

function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No search results found for query: "${query}"`
  }

  let output = `Found ${results.length} search result${results.length === 1 ? "" : "s"} for: "${query}"\n\n`

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    output += `${i + 1}. **${result.title}**\n`
    output += `   ${result.url}\n`
    if (result.snippet) {
      output += `   ${result.snippet}\n`
    }
    if (result.publishedDate) {
      output += `   📅 ${new Date(result.publishedDate).toLocaleDateString()}\n`
    }
    output += `\n`
  }

  return output.trim()
}

function cleanCache() {
  const now = Date.now()
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key)
    }
  }
}
