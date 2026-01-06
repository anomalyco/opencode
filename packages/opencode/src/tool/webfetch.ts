import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { LRUCache } from "../util/cache"
import { retry, isRetryableError } from "@opencode-ai/util/retry"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

// Cache configuration: 30 min TTL (web content can change), 200 entries max
// We cache less aggressively than search since web content is more dynamic
const fetchCache = new LRUCache<string>({
  namespace: "webfetch",
  maxSize: 200,
  ttl: 30 * 60 * 1000, // 30 minutes
  persist: true,
})

/**
 * Generate a cache key from fetch parameters
 */
function getCacheKey(url: string, format: string): string {
  return JSON.stringify({ u: url, f: format })
}

/**
 * Check if URL should be cached (skip dynamic content indicators)
 */
function shouldCache(url: string): boolean {
  const skipPatterns = [
    /\bapi\b/i,
    /\bgraphql\b/i,
    /\bauth\b/i,
    /\blogin\b/i,
    /\bsession\b/i,
    /\btoken\b/i,
    /\brandom\b/i,
    /\btimestamp\b/i,
  ]
  return !skipPatterns.some((pattern) => pattern.test(url))
}

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // Validate URL
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        format: params.format,
        timeout: params.timeout,
      },
    })

    // Check cache first for cacheable URLs
    const canCache = shouldCache(params.url)
    if (canCache) {
      const cacheKey = getCacheKey(params.url, params.format)
      const cached = await fetchCache.get(cacheKey)
      if (cached) {
        return {
          output: cached,
          title: `${params.url} (cached)`,
          metadata: { cached: true },
        }
      }
    }

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }

    try {
      const result = await retry(
        async () => {
          // Create fresh timeout for each retry attempt
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeout)

          try {
            const response = await fetch(params.url, {
              signal: AbortSignal.any([controller.signal, ctx.abort]),
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: acceptHeader,
                "Accept-Language": "en-US,en;q=0.9",
              },
            })

            if (!response.ok) {
              throw new Error(`Request failed with status code: ${response.status}`)
            }

            // Check content length
            const contentLength = response.headers.get("content-length")
            if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
              throw new Error("Response too large (exceeds 5MB limit)")
            }

            const arrayBuffer = await response.arrayBuffer()
            if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
              throw new Error("Response too large (exceeds 5MB limit)")
            }

            const content = new TextDecoder().decode(arrayBuffer)
            const contentType = response.headers.get("content-type") || ""

            return { content, contentType }
          } finally {
            clearTimeout(timeoutId)
          }
        },
        {
          attempts: 3,
          delay: 500,
          factor: 2,
          maxDelay: 5000,
          retryIf: isRetryableError,
        },
      )

      const { content, contentType } = result
      const title = `${params.url} (${contentType})`

      let output: string

      // Handle content based on requested format and actual content type
      switch (params.format) {
        case "markdown":
          if (contentType.includes("text/html")) {
            output = convertHTMLToMarkdown(content)
          } else {
            output = content
          }
          break

        case "text":
          if (contentType.includes("text/html")) {
            output = await extractTextFromHTML(content)
          } else {
            output = content
          }
          break

        case "html":
        default:
          output = content
          break
      }

      // Cache successful results for cacheable URLs
      if (canCache) {
        const cacheKey = getCacheKey(params.url, params.format)
        await fetchCache.set(cacheKey, output)
      }

      return {
        output,
        title,
        metadata: { cached: false },
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timed out")
      }

      throw error
    }
  },
})

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
