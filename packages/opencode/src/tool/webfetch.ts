import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { Config } from "../config/config"
import { Permission } from "../permission"
import { lookup } from "dns/promises"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

// SSRF Protection: Blocked hostnames (cloud metadata endpoints)
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data.ec2.internal",
  "169.254.169.254",
  "[fd00:ec2::254]",
])

// SSRF Protection: IPv4 private/internal ranges
const IPV4_PRIVATE_RANGES = [
  { start: 0x7f000000, end: 0x7fffffff }, // 127.0.0.0/8 (localhost)
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8 (private)
  { start: 0xac100000, end: 0xac1fffff }, // 172.16.0.0/12 (private)
  { start: 0xc0a80000, end: 0xc0a8ffff }, // 192.168.0.0/16 (private)
  { start: 0xa9fe0000, end: 0xa9feffff }, // 169.254.0.0/16 (link-local)
  { start: 0x00000000, end: 0x00ffffff }, // 0.0.0.0/8 (current network)
  { start: 0xe0000000, end: 0xefffffff }, // 224.0.0.0/4 (multicast)
  { start: 0xf0000000, end: 0xffffffff }, // 240.0.0.0/4 (reserved/broadcast)
]

/**
 * Convert IPv4 address string to 32-bit integer
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new Error("Invalid IPv4 address")
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/**
 * Check if IPv4 address is in private/internal range
 */
function isPrivateIPv4(ip: string): boolean {
  try {
    const ipInt = ipv4ToInt(ip)
    return IPV4_PRIVATE_RANGES.some((range) => ipInt >= range.start && ipInt <= range.end)
  } catch {
    return false
  }
}

/**
 * Check if IPv6 address is private/internal
 */
function isPrivateIPv6(ip: string): boolean {
  // Normalize IPv6 address
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "")

  // Check for IPv6 localhost
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true
  }

  // Check for IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const ipv4MappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  if (ipv4MappedMatch) {
    return isPrivateIPv4(ipv4MappedMatch[1])
  }

  // Check for fc00::/7 (unique local addresses - private)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) {
    return true
  }

  // Check for fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) {
    return true
  }

  // Check for ff00::/8 (multicast)
  if (/^ff[0-9a-f]{2}:/i.test(normalized)) {
    return true
  }

  // Check for :: (unspecified address)
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") {
    return true
  }

  return false
}

/**
 * Check if an IP address (IPv4 or IPv6) is private/internal
 */
function isPrivateIP(ip: string): boolean {
  // Remove brackets from IPv6 addresses
  const cleanIP = ip.replace(/^\[|\]$/g, "")

  // Check if it's IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanIP)) {
    return isPrivateIPv4(cleanIP)
  }

  // Assume IPv6
  return isPrivateIPv6(cleanIP)
}

/**
 * Validate URL for SSRF protection
 * Returns an object with validation result and optional error reason
 */
async function validateUrlForSSRF(urlString: string): Promise<{ valid: boolean; reason?: string }> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { valid: false, reason: "Invalid URL format" }
  }

  // Only allow http and https schemes
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, reason: "Only http and https protocols are allowed" }
  }

  const hostname = url.hostname.toLowerCase()

  // Check against blocked hostnames (cloud metadata endpoints)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: "Access to cloud metadata endpoints is blocked" }
  }

  // Check if hostname is a raw IP address
  const isRawIPv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  const isRawIPv6 = hostname.startsWith("[") && hostname.endsWith("]")

  if (isRawIPv4 || isRawIPv6) {
    // Direct IP address access - check immediately
    if (isPrivateIP(hostname)) {
      return { valid: false, reason: "Access to private/internal IP addresses is blocked" }
    }
  } else {
    // Hostname - resolve DNS and check resolved IP
    try {
      // Resolve both IPv4 and IPv6
      const addresses: string[] = []

      try {
        const ipv4Result = await lookup(hostname, { family: 4 })
        addresses.push(ipv4Result.address)
      } catch {
        // No IPv4 address
      }

      try {
        const ipv6Result = await lookup(hostname, { family: 6 })
        addresses.push(ipv6Result.address)
      } catch {
        // No IPv6 address
      }

      if (addresses.length === 0) {
        return { valid: false, reason: "Unable to resolve hostname" }
      }

      // Check all resolved addresses
      for (const address of addresses) {
        if (isPrivateIP(address)) {
          return {
            valid: false,
            reason: `Hostname resolves to private/internal IP address (${address})`,
          }
        }
      }
    } catch (err) {
      return { valid: false, reason: `DNS resolution failed: ${err instanceof Error ? err.message : "Unknown error"}` }
    }
  }

  return { valid: true }
}

/**
 * Validate redirect URL to prevent SSRF via redirects (DNS rebinding protection)
 */
async function validateRedirectUrl(
  originalUrl: string,
  redirectUrl: string,
): Promise<{ valid: boolean; reason?: string }> {
  // First validate the redirect URL itself
  const validation = await validateUrlForSSRF(redirectUrl)
  if (!validation.valid) {
    return {
      valid: false,
      reason: `Redirect blocked: ${validation.reason}`,
    }
  }

  return { valid: true }
}

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .describe("The format to return the content in (text, markdown, or html)"),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // Validate URL format
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    // SSRF Protection: Validate URL before fetching
    const ssrfValidation = await validateUrlForSSRF(params.url)
    if (!ssrfValidation.valid) {
      throw new Error(`SSRF protection: ${ssrfValidation.reason}`)
    }

    const cfg = await Config.get()
    if (cfg.permission?.webfetch === "ask")
      await Permission.ask({
        type: "webfetch",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: "Fetch content from: " + params.url,
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

    // SSRF Protection: Manual redirect handling to validate each redirect
    let currentUrl = params.url
    let response: Response
    const maxRedirects = 10
    let redirectCount = 0

    while (true) {
      response = await fetch(currentUrl, {
        signal: AbortSignal.any([controller.signal, ctx.abort]),
        redirect: "manual", // Don't follow redirects automatically
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: acceptHeader,
          "Accept-Language": "en-US,en;q=0.9",
        },
      })

      // Check if this is a redirect
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location) {
          throw new Error(`Redirect response (${response.status}) missing Location header`)
        }

        redirectCount++
        if (redirectCount > maxRedirects) {
          throw new Error(`Too many redirects (max ${maxRedirects})`)
        }

        // Resolve relative URLs
        const redirectUrl = new URL(location, currentUrl).toString()

        // SSRF Protection: Validate redirect URL
        const redirectValidation = await validateRedirectUrl(currentUrl, redirectUrl)
        if (!redirectValidation.valid) {
          throw new Error(`SSRF protection: ${redirectValidation.reason}`)
        }

        currentUrl = redirectUrl
        continue
      }

      // Not a redirect, break out of the loop
      break
    }

    clearTimeout(timeoutId)

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
