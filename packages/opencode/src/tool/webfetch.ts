import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { Token } from "../util/token"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_TOKENS = 50_000 // Maximum tokens to return (to avoid exceeding budget)
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

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

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

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

    const response = await fetch(params.url, {
      signal: AbortSignal.any([controller.signal, ctx.abort]),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: acceptHeader,
        "Accept-Language": "en-US,en;q=0.9",
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`)
    }

    // Check content length and estimate token count
    const contentLength = response.headers.get("content-length")
    if (contentLength) {
      const bytes = parseInt(contentLength)
      if (bytes > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)")
      }

      // Estimate tokens from byte size (rough estimate: 1 token ≈ 4 bytes)
      const estimatedTokens = Math.round(bytes / 4)
      if (estimatedTokens > MAX_TOKENS) {
        return {
          output: `⚠️  Response size check: This URL will return approximately ${estimatedTokens.toLocaleString()} tokens (${(bytes / 1024).toFixed(0)} KB)

This exceeds the safe limit of ${MAX_TOKENS.toLocaleString()} tokens and will likely cause "prompt is too long" errors.

Recommended actions:
• I can fetch it and save to a file in your project directory, then analyze it
• You can ask me to fetch specific parts/fields only if this is an API
• You can provide filters or query parameters to reduce the response size

Would you like me to proceed with fetching and saving to a file, or would you prefer a different approach?`,
          title: `${params.url} [Size Warning]`,
          metadata: {},
        }
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const content = new TextDecoder().decode(arrayBuffer)
    const contentType = response.headers.get("content-type") || ""

    const title = `${params.url} (${contentType})`

    // Handle content based on requested format and actual content type
    let output = ""
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
        output = content
        break

      default:
        output = content
    }

    // Check if response exceeds token limit - if so, summarize intelligently
    const tokenCount = Token.estimate(output)
    if (tokenCount > MAX_TOKENS) {
      const summary = createLargeResponseWarning(output, contentType, params.url, tokenCount)
      return {
        output: summary,
        title: `${title} [Summarized]`,
        metadata: {},
      }
    }

    return {
      output,
      title,
      metadata: {},
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

function createLargeResponseWarning(content: string, contentType: string, url: string, tokenCount: number): string {
  let previewSection = ""

  // Try to provide structure info for JSON
  if (contentType.includes("json") || contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        previewSection = `Type: JSON Array
Items: ${parsed.length}

To avoid exceeding token budget, showing structural summary instead of full content.

First item as example:
${JSON.stringify(parsed[0], null, 2)}`
      } else if (typeof parsed === "object") {
        const keys = Object.keys(parsed)
        const sample = Object.fromEntries(keys.slice(0, 3).map((k) => [k, parsed[k]]))
        previewSection = `Type: JSON Object
Keys: ${keys.length}

To avoid exceeding token budget, showing structural summary instead of full content.

Sample of data:
${JSON.stringify(sample, null, 2)}`
      }
    } catch {
      // Fall through to text preview
    }
  }

  // Fall back to text preview if not JSON or parsing failed
  if (!previewSection) {
    previewSection = `Content-Type: ${contentType}

To avoid exceeding token budget, showing preview instead of full content.

Preview (first 2000 characters):
${content.slice(0, 2000)}...`
  }

  return `⚠️  Large response detected (~${tokenCount.toLocaleString()} tokens)

URL: ${url}
${previewSection}

To access this data, please:
• Ask me to save the full response to a file
• Specify what information you're looking for
• Request specific sections or search terms`
}
