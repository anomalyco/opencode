// Application layer over the Scrapling crawler client: turns a structured
// CrawlResult into a research-ready digest for agent reasoning. Pure module —
// no I/O, no process details, no environment access. Summarization and
// question-answering remain the agent's job; this only shapes its input.

import type { ScraplingCrawlResult } from "./scrapling-crawler"

export interface PageResearchOptions {
  /** Optional extraction/research instruction echoed into the digest. */
  focus?: string
  /** Hard cap on main-content characters. Default 12_000. */
  maxContentChars?: number
  /** Hard cap on listed links (deduplicated). Default 40. */
  maxLinks?: number
  /** Hard cap on structured data items. Default 20. */
  maxStructuredData?: number
}

const DEFAULT_MAX_CONTENT_CHARS = 12_000
const DEFAULT_MAX_LINKS = 40
const DEFAULT_MAX_STRUCTURED_DATA = 20

function headerLines(result: ScraplingCrawlResult, focus?: string): string[] {
  const lines: string[] = ["WEB PAGE RESEARCH"]
  const status = result.response?.status_code
  const mode = result.request?.fetch_mode ?? "unknown"
  lines.push(`URL: ${result.request?.url ?? "unknown"} (${mode})`)

  if (status === undefined || status === null) {
    lines.push("HTTP status: unknown")
  } else if (status >= 200 && status < 300) {
    lines.push(`HTTP status: ${status}`)
  } else {
    lines.push(`HTTP status: ${status} (non-OK response — content may be an error page)`)
  }

  if (result.page?.title) lines.push(`Title: ${result.page.title}`)
  if (result.page?.description) lines.push(`Description: ${result.page.description}`)
  if (result.page?.language) lines.push(`Language: ${result.page.language}`)
  if (result.page?.canonical_url) lines.push(`Canonical URL: ${result.page.canonical_url}`)
  if (focus) lines.push(`Research focus: ${focus}`)
  return lines
}

function contentLines(result: ScraplingCrawlResult, maxContentChars: number): string[] {
  const text = result.content?.text?.trim()
  if (!text) return ["", "== MAIN CONTENT ==", "(no text extracted)"]

  const lines = ["", `== MAIN CONTENT == (${text.length} chars)`]
  if (text.length <= maxContentChars) return [...lines, text]
  return [
    ...lines,
    text.slice(0, maxContentChars),
    `[... truncated ${text.length - maxContentChars} of ${text.length} chars — increase via tool options or crawl a more specific page ...]`,
  ]
}

function headingLines(result: ScraplingCrawlResult): string[] {
  const headings = result.content?.headings ?? []
  if (headings.length === 0) return []
  return ["", "== HEADINGS ==", ...headings.map((h) => `- [h${h.level}] ${h.text}`)]
}

function tableLines(result: ScraplingCrawlResult): string[] {
  const tables = result.content?.tables ?? []
  if (tables.length === 0) return []

  const lines = ["", "== TABLES =="]
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]
    lines.push(`\nTable ${i + 1}:`)

    if (table.headers.length > 0) {
      lines.push(`  Headers: ${table.headers.join(" | ")}`)
      lines.push(`  ${"---".repeat(table.headers.length * 4)}`)
    }

    for (const row of table.rows) {
      lines.push(`  ${row.join(" | ")}`)
    }
  }
  return lines
}

function listLines(result: ScraplingCrawlResult): string[] {
  const lists = result.content?.lists ?? []
  if (lists.length === 0) return []

  const lines = ["", "== LISTS =="]
  for (const item of lists) {
    const indent = "  ".repeat(item.level)
    lines.push(`${indent}- ${item.text}`)
    if (item.nested && item.nested.length > 0) {
      for (const nested of item.nested) {
        const nestedIndent = "  ".repeat(nested.level)
        lines.push(`${nestedIndent}  - ${nested.text}`)
      }
    }
  }
  return lines
}

function linkLines(result: ScraplingCrawlResult, maxLinks: number): string[] {
  const links = result.links ?? []
  if (links.length === 0) return []

  const seen = new Set<string>()
  const deduped = links.filter((l) => {
    if (seen.has(l.url)) return false
    seen.add(l.url)
    return true
  })

  const shown = deduped.slice(0, maxLinks)
  const summary =
    shown.length < deduped.length
      ? `== LINKS == (showing ${shown.length} of ${deduped.length} unique)`
      : `== LINKS == (${deduped.length} unique)`
  return ["", summary, ...shown.map((l) => `- ${l.text || "(no text)"} -> ${l.url}`)]
}

function mediaLines(result: ScraplingCrawlResult): string[] {
  const images = result.images ?? []
  const videos = result.videos ?? []
  if (images.length === 0 && videos.length === 0) return []

  const lines: string[] = ["", "== MEDIA =="]

  if (images.length > 0) {
    lines.push(`\nImages (${images.length}):`)
    for (const img of images) {
      const alt = img.alt ? ` [alt: ${img.alt}]` : ""
      const title = img.title ? ` (title: ${img.title})` : ""
      lines.push(`- ${img.src}${alt}${title}`)
    }
  }

  if (videos.length > 0) {
    lines.push(`\nVideos (${videos.length}):`)
    for (const vid of videos) {
      const type = vid.type ? ` [${vid.type}]` : ""
      const poster = vid.poster ? ` (poster: ${vid.poster})` : ""
      lines.push(`- ${vid.src}${type}${poster}`)
    }
  }

  return lines
}

function structuredDataLines(result: ScraplingCrawlResult, maxItems: number): string[] {
  const items = result.structured_data ?? []
  if (items.length === 0) return []

  const shown = items.slice(0, maxItems)
  const lines = ["", "== STRUCTURED DATA (JSON-LD) =="]

  for (const item of shown) {
    const type = item.type ?? "unknown"
    const name = item.name ? ` — ${item.name}` : ""
    lines.push(`\n[${type}]${name}`)
    if (item.data) {
      // Show a compact representation of the data.
      const entries = Object.entries(item.data).filter(([k]) => !k.startsWith("@"))
      for (const [key, value] of entries.slice(0, 10)) {
        const display = typeof value === "object" ? JSON.stringify(value) : String(value)
        const truncated = display.length > 200 ? display.slice(0, 200) + "..." : display
        lines.push(`  ${key}: ${truncated}`)
      }
      if (entries.length > 10) {
        lines.push(`  ... (${entries.length - 10} more fields)`)
      }
    }
  }

  if (items.length > maxItems) {
    lines.push(`\n[... ${items.length - maxItems} more structured data items truncated]`)
  }

  return lines
}

function breadcrumbLines(result: ScraplingCrawlResult): string[] {
  const breadcrumbs = result.breadcrumbs ?? []
  if (breadcrumbs.length === 0) return []

  const path = breadcrumbs.map((b) => b.text).join(" > ")
  return ["", "== BREADCRUMBS ==", path]
}

function metadataLines(result: ScraplingCrawlResult): string[] {
  const meta = result.metadata as
    | {
        keywords?: string | null
        author?: string | null
        published_time?: string | null
        modified_time?: string | null
        og?: { title?: string | null; description?: string | null; site_name?: string | null; type?: string | null }
        twitter?: { card?: string | null; site?: string | null }
      }
    | undefined

  const pairs: Array<[string, string | null | undefined]> = [
    ["keywords", meta?.keywords],
    ["author", meta?.author],
    ["published_time", meta?.published_time],
    ["modified_time", meta?.modified_time],
    ["og:title", meta?.og?.title],
    ["og:description", meta?.og?.description],
    ["og:site_name", meta?.og?.site_name],
    ["og:type", meta?.og?.type],
    ["twitter:card", meta?.twitter?.card],
    ["twitter:site", meta?.twitter?.site],
  ]

  const present = pairs.filter(([, v]) => v)
  if (present.length === 0) return []
  return ["", "== METADATA ==", ...present.map(([k, v]) => `- ${k}: ${v}`)]
}

export function formatPageResearch(
  result: ScraplingCrawlResult,
  options: PageResearchOptions = {},
): string {
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS
  const maxStructuredData = options.maxStructuredData ?? DEFAULT_MAX_STRUCTURED_DATA

  const sections: string[][] = [
    headerLines(result, options.focus),
    contentLines(result, maxContentChars),
    headingLines(result),
    tableLines(result),
    listLines(result),
    linkLines(result, maxLinks),
    mediaLines(result),
    structuredDataLines(result, maxStructuredData),
    breadcrumbLines(result),
    metadataLines(result),
  ]

  return sections.flat().join("\n")
}
