import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"
import TurndownService from "turndown"
import path from "path"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { CRAWL_DISABLED_MESSAGE, isCrawlEnabled, isScrapeEnabled, SCRAPE_DISABLED_MESSAGE } from "@/cli/cmd/scrape-state"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
  scroll: Schema.optional(Schema.Boolean).annotate({
    description: "Auto-scroll the page to load lazy content during Scrapling fallback (default: false)",
  }),
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
          if (!isCrawlEnabled()) {
            return { output: CRAWL_DISABLED_MESSAGE, title: "WebFetch", metadata: {} }
          }

          if (!isScrapeEnabled()) {
            return { output: SCRAPE_DISABLED_MESSAGE, title: "WebFetch", metadata: {} }
          }

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

          const request = HttpClientRequest.get(params.url).pipe(HttpClientRequest.setHeaders(headers))

          // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
          const initial = yield* http.execute(request).pipe(
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )
          const response =
            initial.status === 403 && initial.headers["cf-mitigated"] === "challenge"
              ? yield* http
                  .execute(HttpClientRequest.get(params.url).pipe(HttpClientRequest.setHeaders({ ...headers, "User-Agent": "opencode" })))
                  .pipe(Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }))
              : initial

          // A 999 response means the primary fetcher was rejected. Decide at
          // runtime whether the TUI agent may select the Scrapling crawler.
          if (response.status === 999) {
            if (!isCrawlEnabled()) {
              return { output: CRAWL_DISABLED_MESSAGE, title: "WebFetch", metadata: {} }
            }

            const output = yield* Effect.tryPromise({
              try: () => crawlWithScrapling(params.url, timeout, params.scroll),
              catch: (error) => new Error(`Scrapling fallback failed: ${error instanceof Error ? error.message : String(error)}`),
            })
            return { output, title: `${params.url} (Scrapling)`, metadata: {} }
          }

          if (response.status < 200 || response.status >= 300) {
            throw new Error(`Request failed with status ${response.status}`)
          }

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const arrayBuffer = yield* response.arrayBuffer
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

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

async function crawlWithScrapling(url: string, timeout: number, scroll?: boolean) {
  const script = path.resolve(import.meta.dirname, "../../../../standalone-crawler/crawler_cli.py")
  const crawlerRoot = path.dirname(script)
  const args = ["python", script, url, "--mode", "http", "--timeout", String(timeout / 1000), "--indent", "0"]
  if (scroll) args.push("--scroll")
  const child = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: crawlerRoot,
    env: { ...process.env, PYTHONPATH: [path.join(crawlerRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(stderr.trim() || `crawler exited with code ${exitCode}`)

  const result: unknown = JSON.parse(stdout)
  if (!isCrawlerResult(result)) throw new Error("crawler returned an invalid response")
  return result.content?.text ?? JSON.stringify(result)
}

function isCrawlerResult(value: unknown): value is { content?: { text?: string } } {
  return typeof value === "object" && value !== null
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
