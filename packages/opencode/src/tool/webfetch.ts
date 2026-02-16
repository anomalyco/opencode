import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { abortAfterAny } from "../util/abort"
import { Identifier } from "../id/id"
import { lookup } from "node:dns/promises"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
])

function isPrivateIP(ip: string): boolean {
  if (ip === "0.0.0.0" || ip === "::") return true

  const parts = ip.split(".")
  if (parts.length === 4) {
    const [a, b, c] = parts.map(Number)
    if (a === 127) return true // 127.0.0.0/8
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b! >= 16 && b! <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local, cloud metadata)
    if (a === 100 && b! >= 64 && b! <= 127) return true // 100.64.0.0/10 (CGNAT)
    if (a === 0) return true // 0.0.0.0/8
    if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 (documentation)
    if (a === 198 && b! >= 18 && b! <= 19) return true // 198.18.0.0/15 (benchmarking)
    if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 (documentation)
    if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 (documentation)
    if (a! >= 224) return true // 224.0.0.0+ (multicast & reserved)
    return false
  }

  const lower = ip.toLowerCase()
  if (lower === "::1") return true
  if (lower.startsWith("fe80:")) return true // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true // unique local
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7)
    if (mapped.includes(".")) return isPrivateIP(mapped)
  }

  return false
}

async function validateURLNotInternal(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Invalid URL")
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "")

  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error("Requests to internal hosts are not allowed")
  }

  if (isPrivateIP(hostname)) {
    throw new Error("Requests to private or internal network addresses are not allowed")
  }

  try {
    const results = await lookup(hostname, { all: true })
    for (const result of Array.isArray(results) ? results : [results]) {
      if (isPrivateIP(result.address)) {
        throw new Error("URL resolved to a private or internal network address")
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private or internal")) throw err
    if (err instanceof Error && err.message.includes("internal hosts")) throw err
    throw new Error(`DNS resolution failed for ${hostname}`)
  }
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

    await validateURLNotInternal(params.url)

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

    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)

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
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
    }

    const initial = await fetch(params.url, { signal, headers })

    // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
    const response =
      initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge"
        ? await fetch(params.url, { signal, headers: { ...headers, "User-Agent": "opencode" } })
        : initial

    clearTimeout()

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

    const contentType = response.headers.get("content-type") || ""
    const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
    const title = `${params.url} (${contentType})`

    // Check if response is an image
    const isImage = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"

    if (isImage) {
      const base64Content = Buffer.from(arrayBuffer).toString("base64")
      return {
        title,
        output: "Image fetched successfully",
        metadata: {},
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime,
            url: `data:${mime};base64,${base64Content}`,
          },
        ],
      }
    }

    const content = new TextDecoder().decode(arrayBuffer)

    // Handle content based on requested format and actual content type
    switch (params.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          const markdown = convertHTMLToMarkdown(content)
          return {
            output: markdown,
            title,
            metadata: {},
          }
        }
        return {
          output: content,
          title,
          metadata: {},
        }

      case "text":
        if (contentType.includes("text/html")) {
          const text = await extractTextFromHTML(content)
          return {
            output: text,
            title,
            metadata: {},
          }
        }
        return {
          output: content,
          title,
          metadata: {},
        }

      case "html":
        return {
          output: content,
          title,
          metadata: {},
        }

      default:
        return {
          output: content,
          title,
          metadata: {},
        }
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
