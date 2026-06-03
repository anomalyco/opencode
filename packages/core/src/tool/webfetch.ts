export * as WebFetchTool from "./webfetch"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Duration, Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import { isIP } from "node:net"
import TurndownService from "turndown"
import { ToolOutputStore } from "../tool-output-store"
import { ToolRegistry } from "../tool-registry"

export const name = "webfetch"
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120
const MAX_REDIRECTS = 10

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. Until hostname connections can be pinned to validated DNS results, URLs must use globally routable literal IP addresses. Local, private, link-local, multicast, unspecified, reserved, and cloud metadata destinations are rejected. This tool is read-only. Large text results are truncated with an opaque managed resource URI for paging.`

const Timeout = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS))

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Timeout.pipe(Schema.optional).annotate({
    description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
  }),
})

const Success = Schema.Struct({
  url: Schema.String,
  contentType: Schema.String,
  format: Parameters.fields.format,
  output: Schema.String,
  truncated: Schema.Boolean,
  resource: ToolOutputStore.Resource.pipe(Schema.optional),
})

type Format = (typeof Parameters.Type)["format"]

const acceptHeader = (format: Format) => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

const headers = (format: Format, userAgent: string) => ({
  "User-Agent": userAgent,
  Accept: acceptHeader(format),
  "Accept-Language": "en-US,en;q=0.9",
})

const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

const isCloudflareChallenge = (error: unknown) => {
  if (!error || typeof error !== "object" || !("reason" in error)) return false
  const reason = error.reason
  if (
    !reason ||
    typeof reason !== "object" ||
    !("_tag" in reason) ||
    reason._tag !== "StatusCodeError" ||
    !("response" in reason)
  )
    return false
  const response = reason.response as HttpClientResponse.HttpClientResponse
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge"
}

const request = (url: string, format: Format, userAgent = browserUserAgent) =>
  HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers(format, userAgent)))

const cloudMetadataHostnames = new Set(["metadata", "metadata.google.internal", "instance-data", "instance-data.ec2.internal"])
const cloudMetadataIPv4 = new Set(["169.254.169.254", "100.100.100.200"])

const parseIPv4 = (address: string) => {
  const parts = address.split(".")
  if (parts.length !== 4) return undefined
  const bytes = parts.map(Number)
  return bytes.every((byte, index) => String(byte) === parts[index] && byte >= 0 && byte <= 255) ? bytes : undefined
}

const parseIPv6 = (address: string) => {
  const halves = address.split("::")
  if (halves.length > 2) return undefined
  const parse = (part: string) => {
    if (!part) return []
    const words = part.split(":")
    const last = words.at(-1)
    if (last?.includes(".")) {
      const bytes = parseIPv4(last)
      if (!bytes) return undefined
      words.splice(-1, 1, ((bytes[0]! << 8) | bytes[1]!).toString(16), ((bytes[2]! << 8) | bytes[3]!).toString(16))
    }
    if (!words.every((word) => /^[0-9a-f]{1,4}$/i.test(word))) return undefined
    return words.map((word) => Number.parseInt(word, 16))
  }
  const left = parse(halves[0]!)
  const right = parse(halves[1] ?? "")
  if (!left || !right) return undefined
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined
  return [...left, ...Array<number>(missing).fill(0), ...right]
}

const isBlockedIPv4 = (address: string) => {
  if (cloudMetadataIPv4.has(address)) return true
  const bytes = parseIPv4(address)
  if (!bytes) return true
  const [a, b] = bytes
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  )
}

const isBlockedIPv6 = (address: string) => {
  const words = parseIPv6(address)
  if (!words) return true
  const [first, ...rest] = words
  if (first === 0 && rest.slice(0, 6).every((word) => word === 0) && rest[6] === 1) return true
  if (first === 0 && rest.every((word) => word === 0)) return true
  if ((first! & 0xfe00) === 0xfc00 || (first! & 0xffc0) === 0xfe80 || (first! & 0xffc0) === 0xfec0 || (first! & 0xff00) === 0xff00) return true
  if (words.slice(0, 6).every((word) => word === 0) && words[6] !== 0) {
    return isBlockedIPv4(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`)
  }
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isBlockedIPv4(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`)
  }
  return false
}

const assertPublicAddress = (address: string) => {
  const family = isIP(address)
  if (family === 4 ? isBlockedIPv4(address) : family === 6 ? isBlockedIPv6(address) : true) {
    throw new Error(`URL resolves to a blocked network address: ${address}`)
  }
}

const assertPublicHostname = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (cloudMetadataHostnames.has(hostname)) throw new Error(`URL uses a blocked cloud metadata hostname: ${hostname}`)
  if (!isIP(hostname)) throw new Error("URL hostname fetching is unavailable until DNS connections can be pinned")
  assertPublicAddress(hostname)
  return hostname
}

const assertPublicDestination = (url: URL) =>
  Effect.gen(function* () {
    const hostname = assertPublicHostname(url)
    return assertPublicAddress(hostname)
  })

const execute = (http: HttpClient.HttpClient, url: string, format: Format, userAgent = browserUserAgent) => {
  const loop = (url: string, redirects: number): Effect.Effect<HttpClientResponse.HttpClientResponse, unknown> =>
    Effect.gen(function* () {
      const parsed = new URL(url)
      yield* assertPublicDestination(parsed)
      const response = yield* http.execute(request(url, format, userAgent)).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      )
      if (response.status < 300 || response.status >= 400 || !response.headers.location) return response
      if (redirects >= MAX_REDIRECTS) throw new Error(`Too many redirects (exceeds ${MAX_REDIRECTS} redirect limit)`)
      return yield* loop(new URL(response.headers.location, parsed).toString(), redirects + 1)
    })
  return loop(url, 0).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
}

const collectBody = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    const contentLength = response.headers["content-length"]
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return yield* Effect.die(new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`))
    }
    const chunks: Uint8Array[] = []
    let size = 0
    yield* Stream.runForEach(response.stream, (chunk) =>
      Effect.sync(() => {
        size += chunk.byteLength
        if (size > MAX_RESPONSE_BYTES) throw new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`)
        chunks.push(chunk)
      }),
    )
    return Buffer.concat(chunks, size)
  })

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"
const outputMime = (format: Format) =>
  format === "markdown" ? "text/markdown" : format === "html" ? "text/html" : "text/plain"

const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

const definition = Tool.make({
  description,
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: output.output })],
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const http = yield* HttpClient.HttpClient
    const resources = yield* ToolOutputStore.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID, call, assertPermission }) =>
          Effect.gen(function* () {
            const parsed = new URL(parameters.url)
            assertPublicHostname(parsed)

            yield* assertPermission({ action: name, resources: [parameters.url], save: ["*"], metadata: parameters })

            const { body, contentType } = yield* Effect.gen(function* () {
              const response = yield* execute(http, parameters.url, parameters.format).pipe(
                Effect.catchIf(isCloudflareChallenge, () => execute(http, parameters.url, parameters.format, "opencode")),
              )
              const contentType = response.headers["content-type"] || ""
              const mime = mimeFrom(contentType)
              if (isImageAttachment(mime)) throw new Error(`Unsupported fetched image content type: ${mime}`)
              if (!isTextualMime(mime)) throw new Error(`Unsupported fetched file content type: ${mime}`)
              return { body: yield* collectBody(response), contentType }
            }).pipe(
              Effect.timeoutOrElse({
                duration: Duration.seconds(parameters.timeout ?? DEFAULT_TIMEOUT_SECONDS),
                orElse: () => Effect.die(new Error("Request timed out")),
              }),
            )
            const content = convert(new TextDecoder().decode(body), contentType, parameters.format)
            const truncated = yield* resources.truncate({
              sessionID,
              toolCallID: call.id,
              content,
              mime: outputMime(parameters.format),
            })
            return {
              url: parameters.url,
              contentType,
              format: parameters.format,
              output: truncated.content,
              truncated: truncated.truncated,
              ...(truncated.truncated ? { resource: truncated.resource } : {}),
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ToolFailure({ message: `Unable to fetch ${parameters.url}`, error: Cause.squash(cause) }),
              ),
            ),
          ),
      }),
    )
  }),
)

export function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) skipDepth++
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

export function convertHTMLToMarkdown(html: string) {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndown.remove(["script", "style", "meta", "link"])
  return turndown.turndown(html)
}
