import { Effect } from "effect"
import { CliError } from "../effect-cmd"
import { UI } from "../ui"
import fs from "fs/promises"
import path from "path"

export function sanitizeFolderName(name: string): string {
  return name
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 120)
}

function cleanMarkdown(html: string): string {
  let md = html
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "")
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "")
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, "")
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, "")
  md = md.replace(/<header[\s\S]*?<\/header>/gi, "")
  md = md.replace(/<aside[\s\S]*?<\/aside>/gi, "")
  md = md.replace(/\n{3,}/g, "\n\n")
  md = md.replace(/[ \t]{2,}/g, " ")
  return md.trim()
}

function loadApiKey(): string | null {
  const envKey = process.env["FIRECRAWL_API_KEY"]
  if (envKey) return envKey
  try {
    const envPath = path.join(process.cwd(), ".env")
    const content = require("fs").readFileSync(envPath, "utf-8")
    const match = content.match(/^FIRECRAWL_API_KEY\s*=\s*(.+)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, "")
  } catch { }
  return null
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

export const firecrawlScrapeHandler = Effect.fn("Cli.firecrawl.scrape")(function* (args: {
  url: string
  output: string
  formats: "markdown" | "html" | "both"
  timeout: number
  "wait-for-selector"?: string
  "only-main-content": boolean
  provider: "firecrawl" | "auto"
  cookie?: string
}) {
  const apiKey = loadApiKey()
  if (!apiKey) {
    return yield* new CliError({
      message: "FIRECRAWL_API_KEY environment variable not set. Get a key at https://firecrawl.dev",
    })
  }

  UI.empty()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "  Firecrawl Scrape" + UI.Style.TEXT_NORMAL)
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  URL:              " + UI.Style.TEXT_NORMAL + args.url)
  UI.println(UI.Style.TEXT_DIM + "  Output:           " + UI.Style.TEXT_NORMAL + args.output)
  UI.println(UI.Style.TEXT_DIM + "  Formats:          " + UI.Style.TEXT_NORMAL + args.formats)
  UI.println(UI.Style.TEXT_DIM + "  Timeout:          " + UI.Style.TEXT_NORMAL + `${args.timeout}ms`)
  UI.println(UI.Style.TEXT_DIM + "  Only main content:" + UI.Style.TEXT_NORMAL + `${args["only-main-content"]}`)
  UI.println(UI.Style.TEXT_DIM + "  Provider:         " + UI.Style.TEXT_NORMAL + args.provider)
  if (args["wait-for-selector"]) {
    UI.println(UI.Style.TEXT_DIM + "  Wait for selector:" + UI.Style.TEXT_NORMAL + args["wait-for-selector"])
  }
  if (args.cookie) {
    UI.println(UI.Style.TEXT_DIM + "  Cookie:           " + UI.Style.TEXT_NORMAL + "(set)")
  }
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  Initializing Firecrawl SDK..." + UI.Style.TEXT_NORMAL)

  const FirecrawlApp = (yield* Effect.promise(() => import("@mendable/firecrawl-js"))).default
  const app = new FirecrawlApp({ apiKey })

  const scrapeOptions: Record<string, unknown> = {
    formats: args.formats === "both" ? ["markdown", "html"] : [args.formats],
    timeout: args.timeout,
    onlyMainContent: args["only-main-content"],
  }
  if (args["wait-for-selector"]) {
    scrapeOptions.waitForSelector = args["wait-for-selector"]
  }
  if (args.cookie) {
    scrapeOptions.headers = {
      Cookie: args.cookie,
    }
  }

  UI.println(UI.Style.TEXT_DIM + "  Scraping..." + UI.Style.TEXT_NORMAL)

  let result: { markdown?: string; html?: string; metadata?: unknown }
  try {
    result = yield* Effect.tryPromise({
      try: () => app.scrapeUrl(args.url, scrapeOptions),
      catch: (e) => new CliError({ message: `Scrape failed: ${e instanceof Error ? e.message : String(e)}` }),
    }) as Effect.Effect<{ markdown?: string; html?: string; metadata?: unknown }, CliError>
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("unsupported") || msg.includes("403") || msg.includes("blocked")) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD +
        "  Site may be blocking automated access." +
        UI.Style.TEXT_NORMAL,
      )
      UI.println(
        UI.Style.TEXT_DIM +
        "  Tip: Try using the dynamic-crawler command for sites with anti-bot protection." +
        UI.Style.TEXT_NORMAL,
      )
    }
    return yield* new CliError({ message: `Scrape failed: ${msg}` })
  }

  yield* Effect.tryPromise({
    try: async () => {
      await ensureDir(args.output)

      if (args.formats === "markdown" || args.formats === "both") {
        if (result.markdown) {
          await writeFileSafe(path.join(args.output, "page.md"), cleanMarkdown(result.markdown))
        }
      }
      if (args.formats === "html" || args.formats === "both") {
        if (result.html) {
          await writeFileSafe(path.join(args.output, "page.html"), result.html)
        }
      }
      if (result.metadata) {
        await writeJsonSafe(path.join(args.output, "metadata.json"), result.metadata)
      }

      await writeJsonSafe(path.join(args.output, "statistics.json"), {
        url: args.url,
        scrapedAt: new Date().toISOString(),
        formats: args.formats,
        timeout: args.timeout,
        onlyMainContent: args["only-main-content"],
        provider: args.provider,
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
})

export const firecrawlCrawlHandler = Effect.fn("Cli.firecrawl.crawl")(function* (args: {
  url: string
  output: string
  limit: number
  "max-depth": number
  formats: "markdown" | "html" | "both"
  timeout: number
  "exclude-patterns": string[]
  provider: "firecrawl" | "auto"
  cookie?: string
}) {
  const apiKey = loadApiKey()
  if (!apiKey) {
    return yield* new CliError({
      message: "FIRECRAWL_API_KEY environment variable not set. Get a key at https://firecrawl.dev",
    })
  }

  UI.empty()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "  Firecrawl Crawl" + UI.Style.TEXT_NORMAL)
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  URL:              " + UI.Style.TEXT_NORMAL + args.url)
  UI.println(UI.Style.TEXT_DIM + "  Output:           " + UI.Style.TEXT_NORMAL + args.output)
  UI.println(UI.Style.TEXT_DIM + "  Limit:            " + UI.Style.TEXT_NORMAL + `${args.limit}`)
  UI.println(UI.Style.TEXT_DIM + "  Max depth:        " + UI.Style.TEXT_NORMAL + `${args["max-depth"]}`)
  UI.println(UI.Style.TEXT_DIM + "  Formats:          " + UI.Style.TEXT_NORMAL + args.formats)
  UI.println(UI.Style.TEXT_DIM + "  Timeout:          " + UI.Style.TEXT_NORMAL + `${args.timeout}ms`)
  UI.println(UI.Style.TEXT_DIM + "  Provider:         " + UI.Style.TEXT_NORMAL + args.provider)
  if (args["exclude-patterns"].length > 0) {
    UI.println(UI.Style.TEXT_DIM + "  Exclude patterns: " + UI.Style.TEXT_NORMAL + args["exclude-patterns"].join(", "))
  }
  if (args.cookie) {
    UI.println(UI.Style.TEXT_DIM + "  Cookie:           " + UI.Style.TEXT_NORMAL + "(set)")
  }
  UI.empty()

  UI.println(UI.Style.TEXT_DIM + "  Initializing Firecrawl SDK..." + UI.Style.TEXT_NORMAL)

  const FirecrawlApp = (yield* Effect.promise(() => import("@mendable/firecrawl-js"))).default
  const app = new FirecrawlApp({ apiKey })

  const crawlOptions: Record<string, unknown> = {
    limit: args.limit,
    maxDepth: args["max-depth"],
    scrapeOptions: {
      formats: args.formats === "both" ? ["markdown", "html"] : [args.formats],
      timeout: args.timeout,
      onlyMainContent: true,
    },
  }
  if (args["exclude-patterns"].length > 0) {
    crawlOptions.excludePaths = args["exclude-patterns"]
  }
  if (args.cookie) {
    crawlOptions.scrapeOptions.headers = {
      Cookie: args.cookie,
    }
  }

  UI.println(UI.Style.TEXT_DIM + "  Starting crawl..." + UI.Style.TEXT_NORMAL)
  UI.empty()

  let crawlResult: { data?: Array<{ markdown?: string; html?: string; metadata?: { sourceURL?: string } }> }
  try {
    crawlResult = yield* Effect.tryPromise({
      try: () =>
        app.crawlUrl(args.url, crawlOptions, (status: { current: number; total: number }) => {
          if (status.current && status.total) {
            process.stderr.write(`\r  Progress: ${status.current}/${status.total} pages`)
          }
        }),
      catch: (e) => new CliError({ message: `Crawl failed: ${e instanceof Error ? e.message : String(e)}` }),
    }) as Effect.Effect<{ data?: Array<{ markdown?: string; html?: string; metadata?: { sourceURL?: string } }> }, CliError>
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("unsupported") || msg.includes("403") || msg.includes("blocked")) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD +
        "  Site may be blocking automated access." +
        UI.Style.TEXT_NORMAL,
      )
      UI.println(
        UI.Style.TEXT_DIM +
        "  Tip: Try using the dynamic-crawler command for sites with anti-bot protection." +
        UI.Style.TEXT_NORMAL,
      )
    }
    return yield* new CliError({ message: `Crawl failed: ${msg}` })
  }

  process.stderr.write("\r" + " ".repeat(60) + "\r")

  yield* Effect.tryPromise({
    try: async () => {
      await ensureDir(args.output)

      const pages = crawlResult.data ?? []

      const summary: {
        url: string
        crawledAt: string
        totalPages: number
        pages: Array<{ url: string; folder: string }>
      } = {
        url: args.url,
        crawledAt: new Date().toISOString(),
        totalPages: pages.length,
        pages: [],
      }

      let pageIdx = 0
      for (const page of pages) {
        pageIdx++
        const pageUrl = page.metadata?.sourceURL ?? `page-${pageIdx}`
        const folderName = sanitizeFolderName(new URL(pageUrl).hostname + new URL(pageUrl).pathname)
        const pageDir = path.join(args.output, pageIdx.toString().padStart(3, "0") + "_" + folderName)
        await ensureDir(pageDir)

        if (args.formats === "markdown" || args.formats === "both") {
          if (page.markdown) {
            await writeFileSafe(path.join(pageDir, "page.md"), cleanMarkdown(page.markdown))
          }
        }
        if (args.formats === "html" || args.formats === "both") {
          if (page.html) {
            await writeFileSafe(path.join(pageDir, "page.html"), page.html)
          }
        }
        if (page.metadata) {
          await writeJsonSafe(path.join(pageDir, "metadata.json"), page.metadata)
        }

        summary.pages.push({ url: pageUrl, folder: path.relative(args.output, pageDir) })

        UI.println(UI.Style.TEXT_DIM + `  [${pageIdx}/${pages.length}] ` + UI.Style.TEXT_NORMAL + pageUrl)
      }

      await writeJsonSafe(path.join(args.output, "crawl-summary.json"), summary)
    },
    catch: (e) => new CliError({ message: `Failed to write output: ${e instanceof Error ? e.message : String(e)}` }),
  })

  UI.empty()
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  Crawl complete! Pages saved.` + UI.Style.TEXT_NORMAL)
  UI.empty()
})
