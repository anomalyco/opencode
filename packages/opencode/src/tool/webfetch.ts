import { Effect, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import { request as httpsRequest } from "node:https"
import { Readable } from "node:stream"
import type { LookupFunction } from "node:net"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function blockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // IETF protocol assignments (192.0.0.0/24) and TEST-NET-1 (192.0.2.0/24)
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    // Benchmarking (198.18.0.0/15)
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups. Accepts `::` elision,
 * zone suffixes (`%eth0`) and a trailing dotted-quad. Returns `undefined` when
 * the text is not a well-formed IPv6 address. String-prefix checks are not
 * enough: `::ffff:7f00:1`, `0:0:0:0:0:0:0:1` and `fec0::1` all reach blocked
 * destinations while sharing no textual prefix with `::1`.
 */
function parseIPv6(input: string): number[] | undefined {
  const value = input.includes("%") ? input.slice(0, input.indexOf("%")) : input
  const decode = (text: string): number[] | undefined => {
    if (text === "") return []
    const out: number[] = []
    const items = text.split(":")
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.includes(".")) {
        if (i !== items.length - 1) return undefined
        const octets = item.split(".").map(Number)
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
        continue
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return undefined
      out.push(parseInt(item, 16))
    }
    return out
  }

  const sides = value.split("::")
  if (sides.length > 2) return undefined
  const head = decode(sides[0])
  if (!head) return undefined
  if (sides.length === 1) return head.length === 8 ? head : undefined
  const tail = decode(sides[1])
  if (!tail) return undefined
  const missing = 8 - head.length - tail.length
  if (missing < 1) return undefined
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
}

function blockedIPv6(ip: string): boolean {
  const bytes = parseIPv6(ip)
  if (!bytes || bytes.length !== 8) return false
  const zeroBefore = (n: number) => bytes.slice(0, n).every((b) => b === 0)
  const embeddedBlocked = (offset: number) => {
    const value = [bytes[offset] >> 8, bytes[offset] & 0xff, bytes[offset + 1] >> 8, bytes[offset + 1] & 0xff]
    return blockedIPv4(value.join("."))
  }

  // Unspecified (::) and loopback (::1), including fully-expanded forms.
  if (bytes.every((b) => b === 0)) return true
  if (zeroBefore(7) && bytes[7] === 1) return true
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) — check the embedded IPv4.
  if (zeroBefore(5) && bytes[5] === 0xffff) return embeddedBlocked(6)
  if (zeroBefore(6)) return embeddedBlocked(6)
  // NAT64 well-known prefix (64:ff9b::/96) maps an embedded IPv4.
  if (bytes[0] === 0x64 && bytes[1] === 0xff9b && bytes.slice(2, 6).every((b) => b === 0)) return embeddedBlocked(6)
  // Link-local (fe80::/10), site-local (fec0::/10), unique-local (fc00::/7) and multicast (ff00::/8).
  const top = bytes[0]
  return (
    (top & 0xffc0) === 0xfe80 || (top & 0xffc0) === 0xfec0 || (top & 0xfe00) === 0xfc00 || (top & 0xff00) === 0xff00
  )
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return blockedIPv4(address)
  if (version === 6) return blockedIPv6(address)
  return false
}

type Pin = { address: string; family: 4 | 6 }
type PinnedTarget = { dial: string; host?: string; pin?: Pin }

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

// Resolve and vet once, then pin the connection to the vetted address so a name
// that rebinds between check and use cannot reach a private address. Plain HTTP
// rewrites the URL host to the vetted IP; HTTPS keeps the hostname for SNI and
// certificate validation and pins the address through a custom DNS lookup.
async function pinnedTarget(raw: string): Promise<PinnedTarget> {
  const url = new URL(raw)
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error(`Unsupported URL scheme: ${url.protocol}`)
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error(`Refusing to fetch blocked address: ${hostname}`)
    return { dial: raw }
  }
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (records.length === 0) throw new Error(`Could not resolve host: ${hostname}`)
  for (const record of records) {
    if (isBlockedAddress(record.address))
      throw new Error(`Refusing to fetch ${hostname}: resolves to ${record.address}`)
  }
  const chosen = records.find((record) => record.family === 4) ?? records[0]
  const family: 4 | 6 = chosen.family === 6 ? 6 : 4
  if (url.protocol === "http:") {
    const dial = new URL(url)
    dial.hostname = family === 6 ? `[${chosen.address}]` : chosen.address
    return { dial: dial.toString(), host: url.host }
  }
  return { dial: raw, pin: { address: chosen.address, family } }
}

// A fetch that resolves the request hostname to the already-vetted address while
// keeping the URL hostname for TLS SNI and certificate validation. Only HTTPS
// requests reach here.
function pinnedFetch(pin: Pin): typeof globalThis.fetch {
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    // Node's happy-eyeballs path requests `all: true` and expects an address list.
    if (options.all) return callback(null, [{ address: pin.address, family: pin.family }])
    return callback(null, pin.address, pin.family)
  }
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    const headers = new Headers(init?.headers)
    const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          headers: Object.fromEntries(headers.entries()),
          signal: init?.signal ?? undefined,
          lookup: pinnedLookup,
        },
        resolve,
      )
      req.on("error", reject)
      req.end()
    })
    return new Response(Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>, {
      status: response.statusCode ?? 500,
      statusText: response.statusMessage,
      headers: Object.fromEntries(
        Object.entries(response.headers).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, Array.isArray(value) ? value.join(", ") : value]],
        ),
      ),
    })
  }
  return Object.assign(fetch, { preconnect: () => undefined })
}

export async function assertAllowedUrl(raw: string): Promise<void> {
  await pinnedTarget(raw)
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    const executeWithRedirects = Effect.fnUntraced(function* (
      url: string,
      initialHeaders: Record<string, string>,
      ctx: Tool.Context,
    ) {
      let headers = initialHeaders
      let current = url
      let hop = 0
      while (true) {
        // `bypassNetworkCheck` is a test-only escape hatch: `session/tools.ts` builds
        // the tool context `extra` from a fixed key set and never sets this flag.
        const target =
          ctx.extra?.["bypassNetworkCheck"] === true
            ? { dial: current }
            : yield* Effect.promise(() => pinnedTarget(current))
        const requestHeaders = target.host ? { ...headers, Host: target.host } : headers
        const request = HttpClientRequest.get(target.dial).pipe(HttpClientRequest.setHeaders(requestHeaders))
        const raw = http
          .execute(request)
          .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }))
        const response = target.pin
          ? yield* raw.pipe(Effect.provideService(FetchHttpClient.Fetch, pinnedFetch(target.pin)))
          : yield* raw

        // Cloudflare challenge 403s clear with an honest User-Agent (the browser UA's TLS fingerprint is rejected).
        if (
          response.status === 403 &&
          response.headers["cf-mitigated"] === "challenge" &&
          headers["User-Agent"] !== "opencode"
        ) {
          headers = { ...headers, "User-Agent": "opencode" }
          continue
        }

        if (!REDIRECT_STATUSES.has(response.status)) return response

        if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
        const location = response.headers["location"]
        if (!location) throw new Error("Redirect response missing a Location header")
        const next = new URL(location, current)
        if (!ALLOWED_PROTOCOLS.has(next.protocol))
          throw new Error(`Refusing redirect to unsupported scheme: ${next.protocol}`)
        current = next.toString()
        hop++
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
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
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
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

          const response = yield* executeWithRedirects(params.url, headers, ctx).pipe(
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )

          if (response.status < 200 || response.status >= 300) {
            throw new Error(`Request failed with status ${response.status}`)
          }

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          // Stream-cap the body: `content-length` is optional (chunked/HTTP2), so the
          // full response must never be materialized before the size check.
          const chunks: Uint8Array[] = []
          let size = 0
          yield* Stream.runForEach(response.stream, (chunk) =>
            Effect.suspend(() => {
              size += chunk.length
              if (size > MAX_RESPONSE_SIZE) return Effect.fail(new Error("Response too large (exceeds 5MB limit)"))
              chunks.push(chunk)
              return Effect.void
            }),
          )
          const arrayBuffer = Buffer.concat(chunks)

          const contentType = response.headers["content-type"] || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
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
              return { output: content, title, metadata: {} }

            case "text":
              if (contentType.includes("text/html")) {
                return { output: extractTextFromHTML(content), title, metadata: {} }
              }
              return { output: content, title, metadata: {} }

            case "html":
              return { output: content, title, metadata: {} }

            default:
              return { output: content, title, metadata: {} }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })

  parser.write(html)
  parser.end()

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
