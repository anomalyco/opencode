import { Effect } from "effect"
import { CliError } from "../effect-cmd"
import { UI } from "../ui"
import fs from "fs/promises"
import path from "path"
import { scrapeDynamic, crawlDynamic, releaseBrowser, fetchPage, validateMarkdownSize, htmlToMarkdown, sanitizeHtml, extractContentFromHtml } from "./dynamic-crawler"
import type { DynamicCrawlResult, DynamicCrawlStats } from "./dynamic-crawler"

export function sanitizeFolderName(name: string): string {
  return name
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 120)
}

export const dynamicFetchHandler = Effect.fn("Cli.dynamic.fetch")(function* (args: {
  url: string
  header?: string
  output: string
  timeout: number
}) {
  UI.empty()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "  Dynamic Fetch (HTTP)" + UI.Style.TEXT_NORMAL)
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  URL:              " + UI.Style.TEXT_NORMAL + args.url)
  UI.println(UI.Style.TEXT_DIM + "  Output:           " + UI.Style.TEXT_NORMAL + args.output)
  UI.println(UI.Style.TEXT_DIM + "  Timeout:          " + UI.Style.TEXT_NORMAL + `${args.timeout}ms`)
  UI.empty()

  const headers: Record<string, string> = {}
  if (args.header) {
    const [key, ...valueParts] = args.header.split(":")
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join(":").trim()
    }
  }

  UI.println(UI.Style.TEXT_DIM + "  Fetching page..." + UI.Style.TEXT_NORMAL)

  const fetchResult = yield* Effect.tryPromise({
    try: () => fetchPage(args.url, { timeout: args.timeout, headers }),
    catch: (e) => new CliError({ message: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` }),
  })

  if (fetchResult.error) {
    yield* Effect.fail(new CliError({ message: fetchResult.error }))
    return
  }

  if (fetchResult.status < 200 || fetchResult.status >= 400) {
    yield* Effect.fail(new CliError({ message: `HTTP ${fetchResult.status}: Request failed` }))
    return
  }

  UI.println(UI.Style.TEXT_DIM + "  Status:           " + UI.Style.TEXT_NORMAL + `${fetchResult.status}`)
  UI.println(UI.Style.TEXT_DIM + "  HTML size:        " + UI.Style.TEXT_NORMAL + `${fetchResult.html.length} bytes`)

  // Scrapling-inspired content extraction
  const extracted = extractContentFromHtml(fetchResult.html)
  const markdown = extracted.markdown || htmlToMarkdown(sanitizeHtml(fetchResult.html))
  const { content: validatedMarkdown, truncated } = validateMarkdownSize(markdown)

  if (truncated) {
    UI.println(UI.Style.TEXT_DIM + "  Note:             " + UI.Style.TEXT_NORMAL + "Markdown truncated to 5KB")
  }

  UI.println(UI.Style.TEXT_DIM + "  Markdown size:    " + UI.Style.TEXT_NORMAL + `${validatedMarkdown.length} bytes`)
  UI.empty()

  // Save output files
  yield* Effect.tryPromise({
    try: async () => {
      await ensureDir(args.output)
      await writeFileSafe(path.join(args.output, "page.html"), extracted.cleanHtml || fetchResult.html)
      await writeFileSafe(path.join(args.output, "page.md"), cleanMarkdown(validatedMarkdown))
      await writeJsonSafe(path.join(args.output, "metadata.json"), {
        url: args.url,
        fetchedAt: new Date().toISOString(),
        status: fetchResult.status,
        headers: fetchResult.headers,
        htmlSize: fetchResult.html.length,
        markdownSize: validatedMarkdown.length,
        truncated,
        title: extracted.title,
        description: extracted.description,
      })
    },
    catch: (e) => new CliError({ message: `Failed to write output: ${e instanceof Error ? e.message : String(e)}` }),
  })

  UI.println(UI.Style.TEXT_DIM + "  Output files:" + UI.Style.TEXT_NORMAL)
  const files = ["page.html", "page.md", "metadata.json"]
  for (const file of files) {
    UI.println(UI.Style.TEXT_DIM + "    " + UI.Style.TEXT_NORMAL + file)
  }
  UI.empty()
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + "  Fetch completed successfully!" + UI.Style.TEXT_NORMAL)
  UI.empty()
})

function cleanMarkdown(md: string): string {
  let result = md
  
  // Remove notification-related patterns
  const notificationPatterns = [
    /^\d+\s*notifications?$/gm,
    /^notifications?$/gm,
    /^you\s*have\s*\d+.*$/gm,
    /^\d+\s*new.*$/gm,
    /^view\s*all\s*notifications.*$/gm,
    /^mark\s*all\s*as\s*read.*$/gm,
    /^no\s*new\s*notifications.*$/gm,
    /^notifications?\s*(off|on).*$/gm,
    /^get\s*notified.*$/gm,
    /^notification\s*settings.*$/gm,
    /^\d+\s*views?$/gm,
    /^\d+\s*impressions?$/gm,
    /^search\s*appearances?$/gm,
    /^who's\s*viewed.*$/gm,
    /^profile\s*views?$/gm,
    /^post\s*views?$/gm,
    /^article\s*views?$/gm,
  ]
  
  for (const pattern of notificationPatterns) {
    result = result.replace(pattern, "")
  }
  
  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n")
  result = result.replace(/[ \t]{2,}/g, " ")
  return result.trim()
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function writeFileSafe(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, content, "utf-8")
}

async function writeJsonSafe(filePath: string, data: unknown) {
  await writeFileSafe(filePath, JSON.stringify(data, null, 2))
}

export const dynamicScrapeHandler = Effect.fn("Cli.dynamic.scrape")(function* (args: {
  url: string
  cookie?: string
  "cookie-file"?: string
  header?: string
  output: string
  "site-profile": "linkedin" | "whatsapp" | "instagram" | "generic"
  timeout: number
  "wait-for": number
  "wait-for-selector"?: string
  retries: number
  "validate-auth": boolean
}) {
  UI.empty()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "  Dynamic Scrape" + UI.Style.TEXT_NORMAL)
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  URL:              " + UI.Style.TEXT_NORMAL + args.url)
  UI.println(UI.Style.TEXT_DIM + "  Output:           " + UI.Style.TEXT_NORMAL + args.output)
  UI.println(UI.Style.TEXT_DIM + "  Site profile:     " + UI.Style.TEXT_NORMAL + args["site-profile"])
  UI.println(UI.Style.TEXT_DIM + "  Timeout:          " + UI.Style.TEXT_NORMAL + `${args.timeout}ms`)
  UI.println(UI.Style.TEXT_DIM + "  Wait for:         " + UI.Style.TEXT_NORMAL + `${args["wait-for"]}ms`)
  UI.println(UI.Style.TEXT_DIM + "  Retries:          " + UI.Style.TEXT_NORMAL + `${args.retries}`)
  UI.println(UI.Style.TEXT_DIM + "  Validate auth:    " + UI.Style.TEXT_NORMAL + `${args["validate-auth"]}`)
  if (args.cookie) {
    UI.println(UI.Style.TEXT_DIM + "  Cookie:           " + UI.Style.TEXT_NORMAL + "(set)")
  }
  if (args["cookie-file"]) {
    UI.println(UI.Style.TEXT_DIM + "  Cookie file:      " + UI.Style.TEXT_NORMAL + args["cookie-file"])
  }
  if (args["wait-for-selector"]) {
    UI.println(UI.Style.TEXT_DIM + "  Wait for selector:" + UI.Style.TEXT_NORMAL + args["wait-for-selector"])
  }
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  Starting Chrome DevTools Protocol..." + UI.Style.TEXT_NORMAL)

  const headers: Record<string, string> = {}
  if (args.header) {
    const [key, ...valueParts] = args.header.split(":")
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join(":").trim()
    }
  }

  const result = yield* Effect.tryPromise({
    try: () => scrapeDynamic(args.url, {
      cookie: args.cookie,
      cookieFile: args["cookie-file"],
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      timeout: args.timeout,
      waitFor: args["wait-for"],
      waitForSelector: args["wait-for-selector"],
      retries: args.retries,
      validateAuth: args["validate-auth"],
      siteProfile: args["site-profile"],
    }),
    catch: (e) => new CliError({ message: `Scrape failed: ${e instanceof Error ? e.message : String(e)}` }),
  })

  yield* Effect.tryPromise({
    try: async () => {
      await ensureDir(args.output)

      if (result.markdown) {
        await writeFileSafe(path.join(args.output, "page.md"), cleanMarkdown(result.markdown))
      }
      if (result.html) {
        await writeFileSafe(path.join(args.output, "page.html"), result.html)
      }
      await writeJsonSafe(path.join(args.output, "metadata.json"), result.metadata)

      await writeJsonSafe(path.join(args.output, "statistics.json"), {
        url: args.url,
        scrapedAt: new Date().toISOString(),
        authValid: result.authValid,
        retries: result.retries,
        linksFound: result.links.length,
        imagesFound: result.images.length,
        siteProfile: args["site-profile"],
      })
    },
    catch: (e) => new CliError({ message: `Failed to write output: ${e instanceof Error ? e.message : String(e)}` }),
  })

  UI.println(UI.Style.TEXT_SUCCESS_BOLD + "  Scrape complete!" + UI.Style.TEXT_NORMAL)
  UI.empty()
  UI.println(UI.Style.TEXT_DIM + "  Output files:" + UI.Style.TEXT_NORMAL)

  const files = yield* Effect.tryPromise({
    try: () => fs.readdir(args.output),
    catch: () => new CliError({ message: "Failed to list output files" }),
  })
  for (const file of files) {
    UI.println(UI.Style.TEXT_DIM + "    " + UI.Style.TEXT_NORMAL + file)
  }
  UI.empty()

  yield* Effect.tryPromise({
    try: () => releaseBrowser(),
    catch: () => new CliError({ message: "Failed to release browser" }),
  })
})

export const dynamicCrawlHandler = Effect.fn("Cli.dynamic.crawl")(function* (args: {
  url: string
  cookie?: string
  "cookie-file"?: string
  header?: string
  output: string
  "site-profile": "linkedin" | "whatsapp" | "instagram" | "generic"
  timeout: number
  "wait-for": number
  "wait-for-selector"?: string
  retries: number
  "validate-auth": boolean
  limit: number
  "max-depth"?: number
  "include-external-links": boolean
  "skip-patterns": string[]
}) {
  UI.empty()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "  Dynamic Crawl" + UI.Style.TEXT_NORMAL)
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  URL:              " + UI.Style.TEXT_NORMAL + args.url)
  UI.println(UI.Style.TEXT_DIM + "  Output:           " + UI.Style.TEXT_NORMAL + args.output)
  UI.println(UI.Style.TEXT_DIM + "  Site profile:     " + UI.Style.TEXT_NORMAL + args["site-profile"])
  UI.println(UI.Style.TEXT_DIM + "  Limit:            " + UI.Style.TEXT_NORMAL + `${args.limit}`)
  UI.println(UI.Style.TEXT_DIM + "  Timeout:          " + UI.Style.TEXT_NORMAL + `${args.timeout}ms`)
  UI.println(UI.Style.TEXT_DIM + "  Wait for:         " + UI.Style.TEXT_NORMAL + `${args["wait-for"]}ms`)
  UI.println(UI.Style.TEXT_DIM + "  Retries:          " + UI.Style.TEXT_NORMAL + `${args.retries}`)
  UI.println(UI.Style.TEXT_DIM + "  Validate auth:    " + UI.Style.TEXT_NORMAL + `${args["validate-auth"]}`)
  if (args.cookie) {
    UI.println(UI.Style.TEXT_DIM + "  Cookie:           " + UI.Style.TEXT_NORMAL + "(set)")
  }
  if (args["cookie-file"]) {
    UI.println(UI.Style.TEXT_DIM + "  Cookie file:      " + UI.Style.TEXT_NORMAL + args["cookie-file"])
  }
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  Starting Chrome DevTools Protocol..." + UI.Style.TEXT_NORMAL)
  UI.empty()

  const headers: Record<string, string> = {}
  if (args.header) {
    const [key, ...valueParts] = args.header.split(":")
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join(":").trim()
    }
  }

  const { data: results, stats } = yield* Effect.tryPromise({
    try: () => crawlDynamic(args.url, {
      cookie: args.cookie,
      cookieFile: args["cookie-file"],
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      timeout: args.timeout,
      waitFor: args["wait-for"],
      waitForSelector: args["wait-for-selector"],
      retries: args.retries,
      validateAuth: args["validate-auth"],
      siteProfile: args["site-profile"],
      limit: args.limit,
      maxDepth: args["max-depth"],
      includeExternalLinks: args["include-external-links"],
      skipPatterns: args["skip-patterns"],
    }),
    catch: (e) => new CliError({ message: `Crawl failed: ${e instanceof Error ? e.message : String(e)}` }),
  })

  UI.println(UI.Style.TEXT_DIM + `  Crawled ${results.length} pages` + UI.Style.TEXT_NORMAL)
  UI.empty()

  yield* Effect.tryPromise({
    try: async () => {
      await ensureDir(args.output)

      const summary: {
        url: string
        crawledAt: string
        totalPages: number
        pages: Array<{ url: string; folder: string }>
        stats: DynamicCrawlStats
      } = {
        url: args.url,
        crawledAt: new Date().toISOString(),
        totalPages: results.length,
        pages: [],
        stats,
      }

      let pageIdx = 0
      for (const result of results) {
        pageIdx++
        const pageUrl = result.url
        let folderName: string
        try {
          const parsed = new URL(pageUrl)
          folderName = sanitizeFolderName(parsed.hostname + parsed.pathname)
        } catch {
          folderName = `page-${pageIdx}`
        }
        const pageDir = path.join(args.output, pageIdx.toString().padStart(3, "0") + "_" + folderName)
        await ensureDir(pageDir)

        if (result.markdown) {
          await writeFileSafe(path.join(pageDir, "page.md"), cleanMarkdown(result.markdown))
        }
        if (result.html) {
          await writeFileSafe(path.join(pageDir, "page.html"), result.html)
        }
        await writeJsonSafe(path.join(pageDir, "metadata.json"), result.metadata)
        await writeJsonSafe(path.join(pageDir, "page-stats.json"), {
          url: result.url,
          authValid: result.authValid,
          retries: result.retries,
          linksFound: result.links.length,
          imagesFound: result.images.length,
          error: result.error,
        })

        summary.pages.push({ url: pageUrl, folder: path.relative(args.output, pageDir) })

        UI.println(UI.Style.TEXT_DIM + `  [${pageIdx}/${results.length}] ` + UI.Style.TEXT_NORMAL + pageUrl)
      }

      await writeJsonSafe(path.join(args.output, "crawl-summary.json"), summary)
    },
    catch: (e) => new CliError({ message: `Failed to write output: ${e instanceof Error ? e.message : String(e)}` }),
  })

  UI.empty()
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  Crawl complete! ${results.length} pages saved.` + UI.Style.TEXT_NORMAL)
  UI.empty()

  yield* Effect.tryPromise({
    try: () => releaseBrowser(),
    catch: () => new CliError({ message: "Failed to release browser" }),
  })
})
