import { Context, Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import dns from "node:dns/promises"
import net from "node:net"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 5

/**
 * Escape hatch for the SSRF guard below. Users who legitimately need to fetch
 * private/internal addresses (e.g. a dev server on localhost) can set
 * OPENCODE_WEBFETCH_ALLOW_PRIVATE=1; tests provide this reference directly.
 */
export const AllowPrivateFetch = Context.Reference<boolean>("~opencode/webfetch/AllowPrivateFetch", {
  defaultValue: () => {
    const value = process.env["OPENCODE_WEBFETCH_ALLOW_PRIVATE"]
    return value === "1" || value === "true"
  },
})

// SSRF protection: reject targets that resolve to loopback, link-local, or
// private address ranges. Without this, a webfetch (once permitted) could reach
// internal services or cloud metadata endpoints (e.g. 169.254.169.254).

function isPrivateIPv4(p: readonly number[]): boolean {
  const [a, b, c] = p as [number, number, number]
  if (a === 0) return true // "this" network (0.0.0.0/8)
  if (a === 10) return true // private (10.0.0.0/8)
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (100.64.0.0/10)
  if (a === 127) return true // loopback (127.0.0.0/8)
  if (a === 169 && b === 254) return true // link-local (169.254.0.0/16)
  if (a === 172 && b >= 16 && b <= 31) return true // private (172.16.0.0/12)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF (192.0.0.0/24) + TEST-NET-1 (192.0.2.0/24)
  if (a === 192 && b === 168) return true // private (192.168.0.0/16)
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking (198.18.0.0/15)
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2 (198.51.100.0/24)
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3 (203.0.113.0/24)
  if (a >= 224) return true // multicast (224.0.0.0/4), reserved (240.0.0.0/4), broadcast
  return false
}

/**
 * Expand a valid IPv6 address into its 8 16-bit words. Handles `::`
 * compression, trailing dotted-quad (`::ffff:127.0.0.1`), and zone ids
 * (`fe80::1%eth0`). Returns null when the string is not valid IPv6. String
 * prefix checks are NOT sufficient here: `0:0:0:0:0:0:0:1` is loopback but
 * doesn't contain "::1", and fe80::/10 spans first words fe80–febf.
 */
function ipv6Words(ip: string): number[] | null {
  let addr = ip.split("%")[0]!
  if (!net.isIPv6(addr)) return null
  // Convert a trailing dotted-quad into its two hextets.
  const tail = addr.slice(addr.lastIndexOf(":") + 1)
  if (tail.includes(".")) {
    const v4 = tail.split(".").map(Number)
    const hex = `${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
    addr = addr.slice(0, addr.lastIndexOf(":") + 1) + hex
  }
  const [head = "", rest] = addr.split("::")
  const headWords = head === "" ? [] : head.split(":").map((h) => parseInt(h, 16))
  if (!addr.includes("::")) return headWords.length === 8 ? headWords : null
  const restWords = !rest ? [] : rest.split(":").map((h) => parseInt(h, 16))
  const fill = 8 - headWords.length - restWords.length
  if (fill < 0) return null
  return [...headWords, ...Array(fill).fill(0), ...restWords]
}

function embeddedV4(hi: number, lo: number): number[] {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]
}

function isPrivateIPv6(w: number[]): boolean {
  const zeroThrough = (n: number) => w.slice(0, n).every((x) => x === 0)
  if (zeroThrough(7) && w[7]! <= 1) return true // unspecified (::) and loopback (::1)
  const w0 = w[0]!
  if ((w0 & 0xffc0) === 0xfe80) return true // link-local (fe80::/10)
  if ((w0 & 0xffc0) === 0xfec0) return true // site-local, deprecated (fec0::/10)
  if ((w0 & 0xfe00) === 0xfc00) return true // unique local (fc00::/7)
  if ((w0 & 0xff00) === 0xff00) return true // multicast (ff00::/8)
  // Addresses that embed an IPv4 target inherit its privacy:
  if (zeroThrough(5) && w[5] === 0xffff) return isPrivateIPv4(embeddedV4(w[6]!, w[7]!)) // IPv4-mapped (::ffff:0:0/96)
  if (w0 === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0))
    return isPrivateIPv4(embeddedV4(w[6]!, w[7]!)) // NAT64 (64:ff9b::/96)
  if (w0 === 0x2002) return isPrivateIPv4(embeddedV4(w[1]!, w[2]!)) // 6to4 (2002::/16)
  return false
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip.split(".").map(Number))
  const words = ipv6Words(ip)
  if (words) return isPrivateIPv6(words)
  return false
}

const ALLOW_PRIVATE_HINT = "Set OPENCODE_WEBFETCH_ALLOW_PRIVATE=1 to allow fetching private/internal addresses."

/**
 * Pull the charset label out of a Content-Type header, e.g.
 * `text/html; charset=Shift_JIS` -> `shift_jis`. Returns undefined when no
 * charset is declared. Surrounding quotes (`charset="utf-8"`) are stripped.
 */
export function parseCharset(contentType: string): string | undefined {
  const match = contentType.match(/;\s*charset\s*=\s*"?([^";]+)"?/i)
  return match ? match[1]!.trim().toLowerCase() || undefined : undefined
}

/**
 * Decode a response body using the charset advertised in its Content-Type,
 * falling back to UTF-8. Previously every body was decoded as UTF-8, so pages
 * served as windows-1252, shift_jis, euc-kr, etc. came back as mojibake.
 * An unknown/unsupported label (TextDecoder throws on construction) also falls
 * back to UTF-8 rather than failing the whole fetch.
 */
export function decodeBody(buffer: Uint8Array, contentType: string): string {
  const charset = parseCharset(contentType)
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(buffer)
    } catch {
      // Unsupported label — fall through to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(buffer)
}

export async function assertPublicUrl(rawUrl: string): Promise<void> {
  // URL.hostname keeps brackets for IPv6 literals (e.g. "[::1]"); strip them so net.isIP works.
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "")
  // Strip a trailing dot ("localhost." is the same host as "localhost").
  const lower = host.toLowerCase().replace(/\.$/, "")
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    // Covers cloud-internal DNS such as metadata.google.internal and *.internal on GCP.
    lower === "internal" ||
    lower.endsWith(".internal")
  ) {
    throw new Error(`Refusing to fetch internal host: ${host}. ${ALLOW_PRIVATE_HINT}`)
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`Refusing to fetch private/loopback address: ${host}. ${ALLOW_PRIVATE_HINT}`)
    return
  }
  const records = await dns.lookup(host, { all: true })
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error(
        `Refusing to fetch host that resolves to a private address: ${host} -> ${record.address}. ${ALLOW_PRIVATE_HINT}`,
      )
    }
  }
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

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

          // SSRF guard: block loopback / link-local / private targets. Redirect
          // hops are re-validated in the fetch loop below. Remaining known gap:
          // DNS rebinding (a hostname that resolves public here but private when
          // the client re-resolves it) — closing it fully requires pinning the
          // validated IP into the connection, which fetch does not expose.
          const allowPrivate = yield* AllowPrivateFetch
          if (!allowPrivate) {
            yield* Effect.tryPromise({
              try: () => assertPublicUrl(params.url),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            })
          }

          // Clamp to [1s, MAX_TIMEOUT] — a zero/negative timeout would otherwise fail every request instantly.
          const timeout = Math.min(Math.max((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, 1000), MAX_TIMEOUT)

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

          // Redirects are followed manually so that EVERY hop is re-validated by
          // the SSRF guard — otherwise a public URL could 302 to an internal
          // address and the client would follow it silently. `redirect: "manual"`
          // makes the fetch-based client surface 3xx responses; a client layer
          // that still auto-follows simply never yields a 3xx here and degrades
          // to the previous behavior.
          const fetchOnce = (url: string) =>
            http.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers))).pipe(
              // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
              Effect.flatMap((response) =>
                response.status === 403 && response.headers["cf-mitigated"] === "challenge"
                  ? http.execute(
                      HttpClientRequest.get(url).pipe(
                        HttpClientRequest.setHeaders({ ...headers, "User-Agent": "opencode" }),
                      ),
                    )
                  : Effect.succeed(response),
              ),
              Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
            )

          const response = yield* Effect.gen(function* () {
            let url = params.url
            for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
              const response = yield* fetchOnce(url)
              const location = response.headers["location"]
              if (response.status >= 300 && response.status < 400 && location) {
                const next = new URL(location, url)
                if (next.protocol !== "http:" && next.protocol !== "https:") {
                  throw new Error(`Refusing to follow redirect to non-http(s) URL: ${next}`)
                }
                if (!allowPrivate) {
                  yield* Effect.tryPromise({
                    try: () => assertPublicUrl(next.toString()),
                    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
                  })
                }
                url = next.toString()
                continue
              }
              if (response.status < 200 || response.status >= 300) {
                throw new Error(`Request failed with status code: ${response.status}`)
              }
              return response
            }
            throw new Error(`Too many redirects (limit: ${MAX_REDIRECTS})`)
          }).pipe(
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )

          // Check content length up front when advertised.
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          // Stream the body and abort as soon as the size cap is exceeded, instead of
          // buffering the entire (possibly unbounded) response into memory first.
          const chunks: Uint8Array[] = []
          let received = 0
          yield* response.stream.pipe(
            Stream.runForEach((chunk: Uint8Array) =>
              Effect.sync(() => {
                received += chunk.length
                if (received > MAX_RESPONSE_SIZE) {
                  throw new Error("Response too large (exceeds 5MB limit)")
                }
                chunks.push(chunk)
              }),
            ),
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

          const content = decodeBody(arrayBuffer, contentType)

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

// Tags whose text content should never appear in extracted output.
const NON_TEXT_TAGS = new Set(["script", "style", "noscript", "iframe", "object", "embed"])

export function extractTextFromHTML(html: string) {
  let text = ""
  // Count only opens/closes of non-text tags by name. The previous version
  // incremented on *every* nested open tag once inside a skipped region, which
  // could desync (and skip the rest of the document) when a void/self-closing
  // element did not emit a matching close. Tracking skip tags by name is robust
  // to unbalanced void elements.
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (NON_TEXT_TAGS.has(name)) skipDepth++
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag(name) {
      if (NON_TEXT_TAGS.has(name) && skipDepth > 0) skipDepth--
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
