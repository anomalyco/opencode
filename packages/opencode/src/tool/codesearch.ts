import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./codesearch.txt"
import { LRUCache } from "../util/cache"
import { retry, isRetryableError } from "@opencode-ai/util/retry"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
  DEFAULT_TOKENS: 5000,
  TIMEOUT_MS: 30000,
} as const

// Cache configuration: 2 hour TTL (code docs change less frequently), 500 entries max
const codeCache = new LRUCache<string>({
  namespace: "codesearch",
  maxSize: 500,
  ttl: 2 * 60 * 60 * 1000, // 2 hours
  persist: true,
})

interface McpCodeRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      tokensNum: number
    }
  }
}

interface McpCodeResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

/**
 * Generate a cache key from search parameters
 */
function getCacheKey(params: { query: string; tokensNum: number }): string {
  return JSON.stringify({
    q: params.query.toLowerCase().trim(),
    t: params.tokensNum,
  })
}

export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    const tokensNum = params.tokensNum || API_CONFIG.DEFAULT_TOKENS

    // Check cache first
    const cacheKey = getCacheKey({ query: params.query, tokensNum })
    const cached = await codeCache.get(cacheKey)
    if (cached) {
      return {
        output: cached,
        title: `Code search: ${params.query} (cached)`,
        metadata: { cached: true },
      }
    }

    const codeRequest: McpCodeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_code_context_exa",
        arguments: {
          query: params.query,
          tokensNum,
        },
      },
    }

    try {
      const result = await retry(
        async () => {
          // Create fresh timeout for each retry attempt
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS)

          try {
            const headers: Record<string, string> = {
              accept: "application/json, text/event-stream",
              "content-type": "application/json",
            }

            const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
              method: "POST",
              headers,
              body: JSON.stringify(codeRequest),
              signal: AbortSignal.any([controller.signal, ctx.abort]),
            })

            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(`Code search error (${response.status}): ${errorText}`)
            }

            const responseText = await response.text()

            // Parse SSE response
            const lines = responseText.split("\n")
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data: McpCodeResponse = JSON.parse(line.substring(6))
                if (data.result && data.result.content && data.result.content.length > 0) {
                  return data.result.content[0].text
                }
              }
            }

            return null
          } finally {
            clearTimeout(timeoutId)
          }
        },
        {
          attempts: 3,
          delay: 1000,
          factor: 2,
          maxDelay: 10000,
          retryIf: isRetryableError,
        },
      )

      if (result) {
        // Cache successful results
        await codeCache.set(cacheKey, result)

        return {
          output: result,
          title: `Code search: ${params.query}`,
          metadata: { cached: false },
        }
      }

      return {
        output:
          "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
        title: `Code search: ${params.query}`,
        metadata: { cached: false },
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Code search request timed out")
      }

      throw error
    }
  },
})
