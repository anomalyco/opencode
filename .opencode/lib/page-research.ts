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
}

const DEFAULT_MAX_CONTENT_CHARS = 12_000
const DEFAULT_MAX_LINKS = 40

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

function metadataLines(result: ScraplingCrawlResult): string[] {
  const meta = result.metadata as
    | {
        keywords?: string | null
        og?: { title?: string | null; description?: string | null; site_name?: string | null }
        twitter?: { card?: string | null }
      }
    | undefined

  const pairs: Array<[string, string | null | undefined]> = [
    ["keywords", meta?.keywords],
    ["og:title", meta?.og?.title],
    ["og:description", meta?.og?.description],
    ["og:site_name", meta?.og?.site_name],
    ["twitter:card", meta?.twitter?.card],
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

  const sections: string[][] = [
    headerLines(result, options.focus),
    contentLines(result, maxContentChars),
    headingLines(result),
    linkLines(result, maxLinks),
    metadataLines(result),
  ]

  return sections.flat().join("\n")
}
