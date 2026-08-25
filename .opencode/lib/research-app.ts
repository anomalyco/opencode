// Application use-case layer: turns a user request (URL + fetch mode +
// research objective) into an organized ResearchFinding by invoking the
// existing research-page tool. Consumes the tool's structured crawl data
// directly — never as an opaque text blob — and adds no crawling logic.

import { CrawlerError, type ScraplingCrawlResult } from "./scrapling-crawler"
import type { ToolContext } from "@opencode-ai/plugin"
import researchPageTool from "../tools/research-page"

export interface ResearchRequest {
  url: string
  mode?: "http" | "stealth" | "browser"
  /** What the caller wants extracted/answered; echoed into digest + finding. */
  objective?: string
}

export interface ResearchFinding {
  requestedUrl: string
  title: string | null
  finalUrl: string | null
  httpStatus: number | null
  /** True when HTTP status is 2xx. Non-2xx pages still return findings. */
  ok: boolean
  fetchMode: string
  mainContent: string
  headings: Array<{ level: number; text: string }>
  paragraphs: string[]
  links: Array<{ text: string; url: string; external: boolean | null }>
  images: Array<{ src: string; alt: string | null }>
  metadata: {
    description: string | null
    keywords: string | null
    ogTitle: string | null
    ogDescription: string | null
    ogSiteName: string | null
    twitterCard: string | null
  }
  crawlerError: { type: string; message: string } | null
  objective: string | null
  /** Human-readable research digest produced by the page-research formatter. */
  digest: string
}

function requireCrawl(metadata: unknown): ScraplingCrawlResult {
  const crawl = (metadata as { crawl?: unknown } | undefined)?.crawl
  if (!crawl || typeof crawl !== "object") {
    throw new CrawlerError("protocol", "research-page returned no structured crawl payload")
  }
  return crawl as ScraplingCrawlResult
}

// Inert tool context for programmatic invocation; our tool reads none of it.
function stubContext(): ToolContext {
  return {
    sessionID: "research-app",
    messageID: "research-app",
    agent: "research-app",
    directory: import.meta.dir,
    worktree: import.meta.dir,
    abort: new AbortController().signal,
    metadata() {},
    ask() {
      return Promise.reject(new Error("researchPage does not support permission prompts"))
    },
  }
}

function str(value: string | null | undefined): string | null {
  return value ?? null
}

/**
 * Research a single web page end-to-end: validates input, crawls via the
 * local Scrapling python process, organizes the structured result for
 * application consumption. Hard failures (invalid URL, timeouts, malformed
 * output, crawler-reported failure) throw typed CrawlerError.
 */
export async function researchPage(request: ResearchRequest): Promise<ResearchFinding> {
  const raw = await researchPageTool.execute(
    {
      url: request.url,
      mode: request.mode ?? "stealth",
      focus: request.objective,
    },
    stubContext(),
  )
  const toolResult = typeof raw === "string" ? { output: raw } : raw

  const crawl = requireCrawl(toolResult.metadata)
  const meta = crawl.metadata as
    | {
        description?: string | null
        keywords?: string | null
        og?: { title?: string | null; description?: string | null; site_name?: string | null }
        twitter?: { card?: string | null }
      }
    | undefined

  const status = crawl.response?.status_code ?? null

  return {
    requestedUrl: request.url,
    title: str(crawl.page?.title),
    finalUrl: str(crawl.response?.final_url),
    httpStatus: status,
    ok: status !== null && status >= 200 && status < 300,
    fetchMode: crawl.request?.fetch_mode ?? request.mode ?? "unknown",
    mainContent: str(crawl.content?.text) ?? "",
    headings: crawl.content?.headings ?? [],
    paragraphs: crawl.content?.paragraphs ?? [],
    links: (crawl.links ?? []).map((l) => ({ text: l.text, url: l.url, external: l.external ?? null })),
    images: (crawl.images ?? []).map((i) => ({ src: i.src, alt: i.alt ?? null })),
    metadata: {
      description: str(meta?.description),
      keywords: str(meta?.keywords),
      ogTitle: str(meta?.og?.title),
      ogDescription: str(meta?.og?.description),
      ogSiteName: str(meta?.og?.site_name),
      twitterCard: str(meta?.twitter?.card),
    },
    crawlerError: crawl.error ? { type: crawl.error.type, message: crawl.error.message } : null,
    objective: str(request.objective),
    digest: toolResult.output,
  }
}

export { CrawlerError }
