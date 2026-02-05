import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { abortAfterAny } from "../util/abort"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

function isPrivateIP(hostname: string): boolean {
  // Normalize hostname to lowercase
  const h = hostname.toLowerCase()

  // Check for localhost variations
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') {
    return true
  }

  // Check for private IPv4 ranges
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    // 10.0.0.0/8
    if (a === 10) return true
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true
    // 0.0.0.0/8
    if (a === 0) return true
  }

  // Check for IPv6 addresses (must be valid IPv6 format, not just strings starting with fc/fd)
  // IPv6 addresses in URLs are enclosed in brackets: [::1], [fe80::1], etc.
  const ipv6Match = h.match(/^\[([a-f0-9:]+)\]$/) || h.match(/^([a-f0-9:]+)$/)
  if (ipv6Match) {
    const ipv6 = ipv6Match[1]
    // Check for IPv6 private/local ranges
    // fe80::/10 - Link-local
    if (ipv6.startsWith('fe80:') || ipv6.startsWith('fe90:') ||
        ipv6.startsWith('fea0:') || ipv6.startsWith('feb0:')) return true
    // fc00::/7 - Unique local addresses (fc00:: to fdff::)
    if (/^f[cd][0-9a-f]{2}:/.test(ipv6)) return true
    // ::1 - Loopback
    if (ipv6 === '::1' || ipv6 === '0:0:0:0:0:0:0:1') return true
    // :: - Unspecified
    if (ipv6 === '::' || ipv6 === '0:0:0:0:0:0:0:0') return true
    // IPv4-mapped IPv6 (::ffff:192.168.x.x)
    const mappedMatch = ipv6.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i)
    if (mappedMatch) {
      const [, a, b] = mappedMatch.map(Number)
      if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 169 && b === 254)) return true
    }
  }

  return false
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

    // Check for private/internal IPs to prevent SSRF
    try {
      const url = new URL(params.url)
      if (isPrivateIP(url.hostname)) {
        throw new Error("Access to private/internal IP addresses is not allowed")
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("private/internal")) {
        throw e
      }
      throw new Error("Invalid URL format")
    }

    // Note: DNS rebinding attacks are mitigated by checking the hostname before fetch,
    // but a determined attacker could still bypass this. For high-security environments,
    // consider using a DNS-over-HTTPS resolver that pins results or a proxy that validates IPs.

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

    const content = new TextDecoder().decode(arrayBuffer)
    const contentType = response.headers.get("content-type") || ""

    const title = `${params.url} (${contentType})`

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
