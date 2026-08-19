import { Effect } from "effect"
import { CliError } from "../effect-cmd"
import { UI } from "../ui"
import fs from "fs/promises"
import path from "path"
import { scrapeDynamic, crawlDynamic, releaseBrowser } from "./dynamic-crawler"
import type { DynamicCrawlResult, DynamicCrawlStats } from "./dynamic-crawler"

export function sanitizeFolderName(name: string): string {
  return name
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 120)
}

function cleanMarkdown(md: string): string {
  let result = md
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
  "godmode-fallback": boolean
  "no-godmode-fallback"?: boolean
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
  UI.println(UI.Style.TEXT_DIM + "  GodMode fallback: " + UI.Style.TEXT_NORMAL + `${args["no-godmode-fallback"] ? false : args["godmode-fallback"]}`)
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
      godModeFallback: args["no-godmode-fallback"] ? false : args["godmode-fallback"],
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
  "godmode-fallback": boolean
  "no-godmode-fallback"?: boolean
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
  UI.println(UI.Style.TEXT_DIM + "  GodMode fallback: " + UI.Style.TEXT_NORMAL + `${args["no-godmode-fallback"] ? false : args["godmode-fallback"]}`)
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
      godModeFallback: args["no-godmode-fallback"] ? false : args["godmode-fallback"],
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
