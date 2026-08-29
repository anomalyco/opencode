import { effectCmd, fail, CliError } from "../effect-cmd"
import { Effect } from "effect"
import { ZipWriter, BlobWriter, BlobReader } from "@zip.js/zip.js"
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { execFile } from "child_process"
import { isScrapeEnabled, setScrapeState, SCRAPE_DISABLED_MESSAGE, isCrawlEnabled, setCrawlState, CRAWL_DISABLED_MESSAGE } from "./scrape-state"


const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  mdash: "\u2014",
  ndash: "\u2013",
  ldquo: "\u201C",
  rdquo: "\u201D",
  lsquo: "\u2018",
  rsquo: "\u2019",
  hellip: "\u2026",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  times: "\u00D7",
  divide: "\u00F7",
}

function decodeEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCharCode(parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith("#")) {
      return String.fromCharCode(parseInt(entity.slice(1), 10))
    }
    return HTML_ENTITY_MAP[entity] ?? match
  })
}

function extractText(html: string): string {
  let text = html
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "")
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "")
  text = text.replace(/<!--[\s\S]*?-->/g, "")
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "")

  const blockTags = [
    "div", "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
    "li", "tr", "blockquote", "pre", "section", "article",
    "header", "footer", "main", "aside", "nav", "figure", "figcaption",
  ]

  for (const tag of blockTags) {
    const brPattern = tag === "br" ? /<br\s*\/?>/gi : new RegExp(`<${tag}[^>]*>`, "gi")
    text = tag === "br" ? text.replace(brPattern, "\n") : text.replace(brPattern, "\n")
  }

  for (const tag of blockTags) {
    if (tag === "br") continue
    text = text.replace(new RegExp(`</${tag}[^>]*>`, "gi"), "\n")
  }

  text = text.replace(/<[^>]+>/g, " ")
  text = decodeEntities(text)
  text = text.replace(/[ \t]+/g, " ")
  text = text.replace(/\n\s+/g, "\n")
  text = text.replace(/\n{3,}/g, "\n\n")
  text = text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n")
  return text.trim()
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeEntities(match[1].trim()) : ""
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {}
  const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
  if (descMatch) meta.description = decodeEntities(descMatch[1].trim())
  const ogTitle = html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([\s\S]*?)["']/i)
  if (ogTitle) meta["og:title"] = decodeEntities(ogTitle[1].trim())
  const ogDesc = html.match(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i)
  if (ogDesc) meta["og:description"] = decodeEntities(ogDesc[1].trim())
  return meta
}

const CRAWLER_PROFILE_DIR = join(homedir(), ".opencode", ".crawler-profile")

function removeStaleLocks(dir: string) {
  if (!existsSync(dir)) return
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) {
          removeStaleLocks(full)
        } else if (entry === "LOCK" || entry.endsWith(".lock")) {
          unlinkSync(full)
        }
      } catch {}
    }
  } catch {}
}

function getProfileDir(): string {
  if (!existsSync(CRAWLER_PROFILE_DIR)) mkdirSync(CRAWLER_PROFILE_DIR, { recursive: true })
  removeStaleLocks(CRAWLER_PROFILE_DIR)
  return CRAWLER_PROFILE_DIR
}

function isLinkedInUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("linkedin.com")
  } catch {
    return false
  }
}

function getPresetHeaders(url: string): Record<string, string> {
  if (isLinkedInUrl(url)) {
    return {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    }
  }
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  }
}

interface CrawlResult {
  url: string
  status: number
  title: string
  meta: Record<string, string>
  content: string
  posts?: Array<{ text: string; time?: string; likes?: string; comments?: string }>
  error?: string
}

async function crawlWithFetch(
  urls: string[],
  maxChars: number,
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  const tasks = urls.map(async (url) => {
    try {
      new URL(url)
    } catch {
      results.push({ url, status: 0, title: "", meta: {}, content: "", error: "Invalid URL" })
      return
    }

    try {
      const headers = getPresetHeaders(url)
      const resp = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      })
      const html = await resp.text()
      const title = extractTitle(html)
      const meta = extractMeta(html)
      const content = extractText(html).slice(0, maxChars)
      results.push({ url, status: resp.status, title, meta, content })
    } catch (err) {
      results.push({
        url,
        status: 0,
        title: "",
        meta: {},
        content: "",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  await Promise.all(tasks)
  return results
}

async function crawlWithBrowser(
  urls: string[],
  maxChars: number,
  doScroll: boolean,
  maxScrolls: number,
): Promise<CrawlResult[]> {
  const scriptPath = join(import.meta.dirname ?? __dirname, "crawl-browser.mjs")
  const input = JSON.stringify({ urls, maxChars, doScroll, maxScrolls })

  const output = await new Promise<string>((resolve, reject) => {
    execFile("node", [scriptPath, input], { maxBuffer: 50 * 1024 * 1024, timeout: 300_000 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr)
      if (err) reject(err)
      else resolve(stdout)
    })
  })

  return JSON.parse(output) as CrawlResult[]
}

function sanitizeFilename(url: string): string {
  try {
    const u = new URL(url)
    let name = u.hostname + u.pathname
    name = name.replace(/[^a-zA-Z0-9._-]/g, "_")
    name = name.replace(/_+/g, "_")
    name = name.replace(/^_|_$/g, "")
    return name.slice(0, 100) || "page"
  } catch {
    return "invalid_url"
  }
}

async function openLoginBrowser(loginUrl: string): Promise<void> {
  const scriptPath = join(import.meta.dirname ?? __dirname, "crawl-login.mjs")
  await new Promise<void>((resolve, reject) => {
    execFile("node", [scriptPath, loginUrl], { timeout: 300_000 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr)
      if (err) reject(err)
      else resolve()
    })
  })
}

function resultToMarkdown(result: CrawlResult): string {
  const lines: string[] = []
  lines.push(`# ${result.title || "Untitled"}`)
  lines.push("")
  lines.push(`**URL:** ${result.url}  `)
  lines.push(`**Status:** ${result.status}`)
  if (result.error) lines.push(`**Error:** ${result.error}`)
  lines.push("")

  if (Object.keys(result.meta).length > 0) {
    lines.push("## Metadata")
    lines.push("")
    for (const [key, value] of Object.entries(result.meta)) {
      lines.push(`- **${key}:** ${value}`)
    }
    lines.push("")
  }

  lines.push("## Content")
  lines.push("")
  lines.push(result.content || "(empty)")
  lines.push("")

  if (result.posts && result.posts.length > 0) {
    lines.push(`## Posts (${result.posts.length})`)
    lines.push("")
    for (let i = 0; i < result.posts.length; i++) {
      const post = result.posts[i]
      lines.push(`### Post ${i + 1}`)
      lines.push("")
      if (post.time) lines.push(`**Date:** ${post.time}  `)
      if (post.likes) lines.push(`**Likes:** ${post.likes}  `)
      if (post.comments) lines.push(`**Comments:** ${post.comments}`)
      lines.push("")
      lines.push(post.text)
      lines.push("")
      lines.push("---")
      lines.push("")
    }
  }

  return lines.join("\n")
}

function resultsToMarkdown(results: CrawlResult[]): string {
  const parts: string[] = []
  for (const result of results) {
    parts.push(resultToMarkdown(result))
  }
  parts.push("---")
  parts.push("")
  parts.push(`*Crawled on ${new Date().toISOString()}*`)
  return parts.join("\n")
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function resultToHtml(result: CrawlResult): string {
  const lines: string[] = []
  lines.push(`<h1>${escapeHtml(result.title || "Untitled")}</h1>`)
  lines.push(`<p><strong>URL:</strong> <a href="${escapeHtml(result.url)}">${escapeHtml(result.url)}</a></p>`)
  lines.push(`<p><strong>Status:</strong> ${result.status}</p>`)
  if (result.error) lines.push(`<p><strong>Error:</strong> ${escapeHtml(result.error)}</p>`)

  if (Object.keys(result.meta).length > 0) {
    lines.push("<h2>Metadata</h2>")
    lines.push("<ul>")
    for (const [key, value] of Object.entries(result.meta)) {
      lines.push(`<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`)
    }
    lines.push("</ul>")
  }

  lines.push("<h2>Content</h2>")
  lines.push(`<pre>${escapeHtml(result.content || "(empty)")}</pre>`)

  if (result.posts && result.posts.length > 0) {
    lines.push(`<h2>Posts (${result.posts.length})</h2>`)
    for (let i = 0; i < result.posts.length; i++) {
      const post = result.posts[i]
      lines.push(`<h3>Post ${i + 1}</h3>`)
      if (post.time) lines.push(`<p><strong>Date:</strong> ${escapeHtml(post.time)}</p>`)
      if (post.likes) lines.push(`<p><strong>Likes:</strong> ${escapeHtml(post.likes)}</p>`)
      if (post.comments) lines.push(`<p><strong>Comments:</strong> ${escapeHtml(post.comments)}</p>`)
      lines.push(`<pre>${escapeHtml(post.text)}</pre>`)
      lines.push("<hr>")
    }
  }

  return lines.join("\n")
}

function resultsToHtml(results: CrawlResult[]): string {
  const body = results.map(resultToHtml).join("\n")
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crawl Results</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    h1 { border-bottom: 2px solid #0077b5; padding-bottom: 10px; }
    h2 { color: #0077b5; margin-top: 30px; }
    h3 { color: #555; }
    pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
    a { color: #0077b5; }
    hr { border: none; border-top: 1px solid #eee; margin: 20px 0; }
    ul { padding-left: 20px; }
    li { margin: 5px 0; }
  </style>
</head>
<body>
${body}
<hr>
<p><em>Crawled on ${new Date().toISOString()}</em></p>
</body>
</html>`
}

export const ScrapeCommand = effectCmd({
  command: "scrape [stateOrUrl] [urls..]",
  describe: "Scrape websites and save extracted data to a zip file",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("stateOrUrl", {
        describe: "State (on/off) or URL to scrape",
        type: "string",
      })
      .positional("urls", {
        describe: "Additional URLs to scrape (space-separated)",
        type: "string",
        array: true,
      })
      .option("browser", {
        alias: "b",
        describe: "Use browser mode (enabled by default for dynamic scrape)",
        type: "boolean",
        default: false,
      })
      .option("output", {
        alias: "o",
        describe: "Output zip file path",
        type: "string",
      })
      .option("max-chars", {
        describe: "Maximum characters of text content per page",
        type: "number",
        default: 20000,
      })
      .option("scroll", {
        describe: "Auto-scroll pages in browser mode",
        type: "boolean",
        default: true,
      })
      .option("max-scrolls", {
        describe: "Maximum scroll iterations per page in browser mode",
        type: "number",
        default: 50,
      })
      .option("login", {
        describe: "Open browser to log in to LinkedIn before scraping",
        type: "boolean",
        default: false,
      })
      .option("format", {
        describe: "Output format: zip (default), md, html, or all",
        type: "string",
        choices: ["zip", "md", "html", "all"],
        default: "zip",
      }),
  handler: Effect.fn("Cli.scrape")(function* (args) {
    const stateOrUrl = args.stateOrUrl as string | undefined

    if (stateOrUrl === "on") {
      setScrapeState(true)
      setCrawlState(true)
      process.stderr.write("Scraping enabled.\n")
      return
    }
    if (stateOrUrl === "off") {
      setScrapeState(false)
      setCrawlState(false)
      process.stderr.write("Scraping disabled.\n")
      return
    }

    if (!isCrawlEnabled()) {
      return yield* fail(CRAWL_DISABLED_MESSAGE)
    }
    if (!isScrapeEnabled()) {
      return yield* fail(SCRAPE_DISABLED_MESSAGE)
    }

    const urls: string[] = []
    if (stateOrUrl && stateOrUrl !== "on" && stateOrUrl !== "off") {
      urls.push(stateOrUrl)
    }
    if (args.urls && args.urls.length > 0) {
      urls.push(...args.urls)
    }

    if (args.login) {
      const loginUrl = "https://www.linkedin.com/login"
      process.stderr.write(`Opening browser for LinkedIn login...\n`)
      yield* Effect.tryPromise({
        try: () => openLoginBrowser(loginUrl),
        catch: (e) => new CliError({ message: e instanceof Error ? e.message : String(e) }),
      })
      process.stderr.write(`Login session saved. You can now scrape LinkedIn profiles.\n`)
      if (urls.length === 0) return
    }

    if (urls.length === 0) {
      return yield* fail("No URLs provided. Usage: opencode dynamic scrape <url1> [url2] ...")
    }

    for (const url of urls) {
      try {
        new URL(url)
      } catch {
        return yield* fail(`Invalid URL: ${url}`)
      }
    }

    const maxChars = args["max-chars"] ?? 20_000
    const doScroll = args.scroll !== false
    const maxScrolls = args["max-scrolls"] ?? 30
    // This command is registered as `opencode dynamic scrape`; rendering in a
    // browser is its core contract, rather than a LinkedIn-only optimization.
    const useBrowser = true

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const format = args.format ?? "zip"
    const outputDir = args.output ?? process.cwd()
    const baseName = `crawl-output-${timestamp}`
    const writeZip = format === "zip" || format === "all"
    const writeMd = format === "md" || format === "all"
    const writeHtml = format === "html" || format === "all"

    const zipPath = join(outputDir, `${baseName}.zip`)
    const mdPath = join(outputDir, `${baseName}.md`)
    const htmlPath = join(outputDir, `${baseName}.html`)

    process.stderr.write(`Crawling ${urls.length} URL(s)...\n`)
    if (useBrowser) {
      process.stderr.write("Using browser mode for JavaScript rendering\n")
    }

    const results: CrawlResult[] = yield* Effect.promise(() =>
      useBrowser
        ? crawlWithBrowser(urls, maxChars, doScroll, maxScrolls)
        : crawlWithFetch(urls, maxChars),
    )

    const addedFiles = new Set<string>()

    // Download profile images for LinkedIn URLs (zip only)
    if (writeZip && useBrowser) {
      const writer = new ZipWriter(new BlobWriter("application/zip"))
      for (const result of results) {
        if (isLinkedInUrl(result.url) && !result.error && result.meta["profileImgUrl"]) {
          yield* Effect.tryPromise({
            try: async () => {
              const imgData = await fetch(result.meta["profileImgUrl"])
              if (imgData.ok) {
                const ext = result.meta["profileImgUrl"].includes(".png") ? "png" : "jpg"
                const imgBlob = await imgData.blob()
                const imgFilename = `${sanitizeFilename(result.url)}_profile.${ext}`

                if (!addedFiles.has(imgFilename)) {
                  addedFiles.add(imgFilename)
                  await writer.add(imgFilename, new BlobReader(imgBlob))
                  process.stderr.write(`  [IMG] Profile image downloaded (${imgFilename})\n`)
                }
              }
            },
            catch: () => new CliError({ message: "Image download failed" }),
          })
        }
      }

      yield* Effect.tryPromise({
        try: async () => {
          for (const result of results) {
            const filename = sanitizeFilename(result.url) + ".md"
            const lines: string[] = []

            lines.push(`<h1><span style="color: #1a73e8;">${result.title || "Untitled"}</span></h1>`)
            lines.push("")
            lines.push(`**URL:** ${result.url}  `)
            lines.push(`**Status:** ${result.status}`)
            if (result.error) lines.push(`**Error:** ${result.error}`)
            lines.push("")

            if (Object.keys(result.meta).length > 0) {
              lines.push("## Metadata")
              lines.push("")
              for (const [key, value] of Object.entries(result.meta)) {
                lines.push(`- **${key}:** ${value}`)
              }
              lines.push("")
            }

            lines.push("## Content")
            lines.push("")
            lines.push(`<span style="color: #1a73e8;">${result.content || "(empty)"}</span>`)
            lines.push("")

            if (result.posts && result.posts.length > 0) {
              lines.push(`## Posts (${result.posts.length})`)
              lines.push("")
              for (let i = 0; i < result.posts.length; i++) {
                const post = result.posts[i]
                lines.push(`<h3><span style="color: #1a73e8;">Post ${i + 1}</span></h3>`)
                lines.push("")
                if (post.time) lines.push(`**Date:** ${post.time}  `)
                if (post.likes) lines.push(`**Likes:** ${post.likes}  `)
                if (post.comments) lines.push(`**Comments:** ${post.comments}`)
                lines.push("")
                lines.push(`<span style="color: #1a73e8;">${post.text}</span>`)
                lines.push("")
                lines.push("---")
                lines.push("")
              }
            }

            const data = lines.join("\n")

            if (!addedFiles.has(filename)) {
              addedFiles.add(filename)
              await writer.add(filename, new BlobReader(new Blob([data], { type: "text/markdown" })))
            }
          }

          const summaryLines: string[] = []
          summaryLines.push(`<h1><span style="color: #1a73e8;">Crawl Summary</span></h1>`)
          summaryLines.push("")
          summaryLines.push(`**Date:** ${new Date().toISOString()}  `)
          summaryLines.push(`**Total URLs:** ${results.length}`)
          summaryLines.push("")
          summaryLines.push("---")
          summaryLines.push("")
          for (const r of results) {
            const status = r.error ? "ERROR" : "OK"
            const postCount = r.posts?.length ?? 0
            const statusColor = r.error ? "#d32f2f" : "#1a73e8"
            summaryLines.push(`- <span style="color: ${statusColor};">**[${status}]**</span> ${r.url}`)
            if (r.title) summaryLines.push(`  - <span style="color: #1a73e8;">${r.title}</span>`)
            if (r.error) summaryLines.push(`  - Error: ${r.error}`)
            if (postCount > 0) summaryLines.push(`  - Posts: ${postCount}`)
            summaryLines.push("")
          }
          await writer.add(
            "_summary.md",
            new BlobReader(new Blob([summaryLines.join("\n")], { type: "text/markdown" })),
          )

          const zip = await writer.close()
          const outputDir2 = dirname(zipPath)
          if (!existsSync(outputDir2)) mkdirSync(outputDir2, { recursive: true })
          writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()))
        },
        catch: (e) => new CliError({ message: e instanceof Error ? e.message : String(e) }),
      })
    }

    yield* Effect.tryPromise({
      try: async () => {
        const outputDir2 = dirname(writeMd ? mdPath : writeHtml ? htmlPath : zipPath)
        if (!existsSync(outputDir2)) mkdirSync(outputDir2, { recursive: true })

        if (writeMd) {
          writeFileSync(mdPath, resultsToMarkdown(results))
          process.stderr.write(`  [MD] ${mdPath}\n`)
        }
        if (writeHtml) {
          writeFileSync(htmlPath, resultsToHtml(results))
          process.stderr.write(`  [HTML] ${htmlPath}\n`)
        }

        for (const result of results) {
          if (result.error) {
            process.stderr.write(`  [ERROR] ${result.url}: ${result.error}\n`)
          } else {
            const postCount = result.posts ? ` (${result.posts.length} posts)` : ""
            process.stderr.write(`  [OK] ${result.url} - ${result.title || "untitled"}${postCount}\n`)
          }
        }
      },
      catch: (e) => new CliError({ message: e instanceof Error ? e.message : String(e) }),
    })

    const successCount = results.filter((r) => !r.error).length
    const errorCount = results.filter((r) => r.error).length
    const totalPosts = results.reduce((sum, r) => sum + (r.posts?.length ?? 0), 0)

    process.stderr.write(`\nDone! ${successCount}/${urls.length} URLs crawled successfully\n`)
    if (totalPosts > 0) {
      process.stderr.write(`Extracted ${totalPosts} LinkedIn posts\n`)
    }
    if (errorCount > 0) {
      process.stderr.write(`${errorCount} URL(s) failed\n`)
    }
    const outputs: string[] = []
    if (writeZip) outputs.push(zipPath)
    if (writeMd) outputs.push(mdPath)
    if (writeHtml) outputs.push(htmlPath)
    process.stderr.write(`Output: ${outputs.join(", ")}\n`)

    process.stdout.write(`Crawl complete. Output saved to: ${outputs.join(", ")}\n`)
  }),
})
