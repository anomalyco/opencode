// High-security site detection and browser-based scraping for TUI flow.
// Only used for sites with strong anti-bot protection (LinkedIn, etc.)
// that require JavaScript rendering and auto-scroll for lazy content.
//
// Flow for high-security sites:
//   TUI request
//   → detect high-security website
//   → Scrapling browser/StealthyFetcher
//   → open the actual webpage
//   → wait for rendering
//   → auto-scroll the complete page
//   → wait for lazy-loaded/dynamic content
//   → extract only the visible rendered page content
//   → return the extracted content to the TUI agent
//
// IMPORTANT: Do NOT fetch initial HTML first for high-security sites.
// The browser path is the only path. No HTTP fallback.

import { crawlWithScrapling, type ScraplingCrawlResult, type ScraplingCrawlOptions } from "./scrapling-crawler"

// ---------------------------------------------------------------------------
// High-security site detection (extensible registry)
// ---------------------------------------------------------------------------

const HIGH_SECURITY_DOMAINS = new Set([
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "glassdoor.com",
  "indeed.com",
])

/**
 * Check if a URL targets a high-security / anti-bot-protected site that
 * requires the Scrapling browser path with auto-scroll.
 *
 * Extensible: add domains to HIGH_SECURITY_DOMAINS as needed.
 */
export function isHighSecuritySite(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    // Match exact domain or any subdomain (e.g. www.linkedin.com)
    for (const domain of HIGH_SECURITY_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return true
      }
    }
  } catch {
    // Malformed URL — not our concern; let the crawler handle it
  }
  return false
}

// ---------------------------------------------------------------------------
// Login wall / restriction detection
// ---------------------------------------------------------------------------

/** Patterns that indicate the page is a login wall, CAPTCHA, or access restriction. */
const LOGIN_WALL_PATTERNS = [
  /sign\s*in\s+to\s+view/i,
  /log\s*in\s+to\s+continue/i,
  /log\s*in\s+to\s+see/i,
  /please\s+sign\s*in/i,
  /please\s+log\s*in/i,
  /join\s+linkedin/i,
  /create\s+(?:a\s+)?(?:free\s+)?account/i,
  /membership\s+required/i,
  /access\s+denied/i,
  /verify\s+you\s+are\s+(?:a\s+)?human/i,
  /captcha/i,
  /security\s+verification/i,
  /unusual\s+traffic/i,
  /blocked\s+(?:your|the)\s+request/i,
  /page\s+not\s+available/i,
  /content\s+not\s+available/i,
  /this\s+page\s+isn't\s+available/i,
  /authentication\s+required/i,
  /to\s+continue,\s+log\s*in/i,
  /to\s+view\s+this\s+profile/i,
  /sign\s*up\s+to\s+/i,
  /get\s+full\s+access/i,
  /limited\s+access/i,
]

/** HTML selectors that commonly appear on login/restriction walls. */
const LOGIN_WALL_SELECTORS = [
  "form[action*='login']",
  "form[action*='auth']",
  ".login-modal",
  ".auth-wall",
  "[data-testid='login']",
  ".sign-in-form",
  "#login-form",
]

export interface LoginWallDetection {
  detected: boolean
  reason?: string
}

/**
 * Detect if the extracted content indicates a login wall, CAPTCHA, or
 * access restriction page rather than the actual profile/content.
 */
export function detectLoginWall(result: ScraplingCrawlResult): LoginWallDetection {
  const text = (result.content?.text ?? "").toLowerCase()
  const title = (result.page?.title ?? "").toLowerCase()
  const combinedText = `${title} ${text}`

  // Check text patterns
  for (const pattern of LOGIN_WALL_PATTERNS) {
    if (pattern.test(combinedText)) {
      return { detected: true, reason: `Pattern matched: ${pattern.source}` }
    }
  }

  // Check for minimal content (typical of restriction pages)
  const paragraphCount = result.content?.paragraphs?.length ?? 0
  const textLength = (result.content?.text ?? "").length
  if (paragraphCount <= 2 && textLength < 500) {
    // Very sparse content — likely a restriction page
    const hasLoginKeywords = /(?:sign|log)\s*(?:in|up)|account|member/i.test(combinedText)
    if (hasLoginKeywords) {
      return { detected: true, reason: "Minimal content with login keywords" }
    }
  }

  return { detected: false }
}

// ---------------------------------------------------------------------------
// Metadata format for TUI response
// ---------------------------------------------------------------------------

export interface HighSecurityScrapeMetadata {
  /** URL that was scraped. */
  url: string
  /** Domain extracted from the URL. */
  domain: string
  /** Scraper engine used. Always "Scrapling" for high-security. */
  scraper: string
  /** Browser mode used. Always "Browser" for high-security. */
  mode: string
  /** Security classification. Always "High". */
  securityLevel: string
  /** Whether the page was JS-rendered. Always true for browser path. */
  rendered: boolean
  /** Whether auto-scroll was performed. Always true for high-security. */
  autoScroll: boolean
  /** Type of content extracted. */
  contentType: string
  /** Source of the scrape. Always "TUI". */
  source: string
}

export interface HighSecurityScrapeDetails {
  /** Whether the initial HTML was fetched directly. Always false for high-security. */
  initialHtmlFetch: boolean
  /** Whether browser navigation was performed. Always true for high-security. */
  browserNavigation: boolean
  /** Number of scroll iterations performed. -1 if unknown. */
  scrollIterations: number
  /** Whether dynamic/lazy content was loaded. */
  dynamicContentLoaded: boolean
  /** Final scroll height in pixels. -1 if unknown. */
  finalScrollHeight: number
  /** Scrape outcome. */
  status: "Success" | "Failed" | "Restricted"
  /** Error message if failed. */
  error?: string
  /** Login wall detection result. */
  loginWall?: LoginWallDetection
}

export interface HighSecurityScrapeResult {
  metadata: HighSecurityScrapeMetadata
  details: HighSecurityScrapeDetails
  /** The page title. */
  title: string
  /** The visible rendered page content (clean text, not raw HTML). */
  content: string
  /** Headings extracted from the page. */
  headings: Array<{ level: number; text: string }>
  /** Links extracted from the page. */
  links: Array<{ text: string; url: string }>
  /** Raw crawl result for programmatic access. */
  raw: ScraplingCrawlResult
}

// ---------------------------------------------------------------------------
// High-security browser scraper
// ---------------------------------------------------------------------------

export interface HighSecurityScrapeOptions {
  url: string
  /** Research focus echoed into the digest. */
  focus?: string
  /** Timeout in ms. Default 90 000 (longer than normal due to scroll). */
  timeoutMs?: number
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}

/**
 * Extract scroll metadata from the crawl result.
 * The Python side logs scroll iterations/height to stderr (not in JSON),
 * so we estimate from the rendered content.
 */
function estimateScrollInfo(result: ScraplingCrawlResult): {
  scrollIterations: number
  finalScrollHeight: number
  dynamicContentLoaded: boolean
} {
  const textLength = (result.content?.text ?? "").length
  const paragraphCount = result.content?.paragraphs?.length ?? 0
  const linkCount = result.links?.length ?? 0

  // If we got substantial content back, scroll likely happened
  const dynamicContentLoaded = textLength > 1000 || paragraphCount > 5

  // We don't have exact scroll metrics from the Python side,
  // but we can report that scrolling was performed
  return {
    scrollIterations: dynamicContentLoaded ? -1 : 0,
    finalScrollHeight: -1,
    dynamicContentLoaded,
  }
}

/**
 * Format a clean, human-readable metadata response for TUI consumption.
 * This is the format the TUI agent receives — not raw JSON.
 */
export function formatHighSecurityResult(result: HighSecurityScrapeResult): string {
  const lines: string[] = []

  // Metadata section
  lines.push("Metadata")
  lines.push(`URL: ${result.metadata.url}`)
  lines.push(`Domain: ${result.metadata.domain}`)
  lines.push(`Scraper: ${result.metadata.scraper}`)
  lines.push(`Mode: ${result.metadata.mode}`)
  lines.push(`Security Level: ${result.metadata.securityLevel}`)
  lines.push(`Rendered: ${result.metadata.rendered ? "Yes" : "No"}`)
  lines.push(`Auto Scroll: ${result.metadata.autoScroll ? "Yes" : "No"}`)
  lines.push(`Content Type: ${result.metadata.contentType}`)
  lines.push(`Source: ${result.metadata.source}`)
  lines.push("")

  // Scrape Details section
  lines.push("Scrape Details")
  lines.push(`Initial HTML Fetch: ${result.details.initialHtmlFetch ? "Yes" : "No"}`)
  lines.push(`Browser Navigation: ${result.details.browserNavigation ? "Yes" : "No"}`)
  lines.push(
    `Scroll Iterations: ${result.details.scrollIterations === -1 ? "completed" : result.details.scrollIterations}`,
  )
  lines.push(`Dynamic Content Loaded: ${result.details.dynamicContentLoaded ? "Yes" : "No"}`)
  lines.push(
    `Final Scroll Height: ${result.details.finalScrollHeight === -1 ? "N/A (completed)" : result.details.finalScrollHeight}`,
  )
  lines.push(`Status: ${result.details.status}`)

  if (result.details.error) {
    lines.push(`Error: ${result.details.error}`)
  }

  if (result.details.loginWall?.detected) {
    lines.push(`Login Wall: Detected — ${result.details.loginWall.reason}`)
  }

  lines.push("")

  // Page Content section
  lines.push("Page Content")
  lines.push(`Title: ${result.title}`)
  lines.push("")

  if (result.details.loginWall?.detected) {
    lines.push("---")
    lines.push("")
    lines.push("⚠ ACCESS RESTRICTION DETECTED")
    lines.push("")
    lines.push(
      "This page appears to be a login wall, CAPTCHA, or access restriction.",
    )
    lines.push("The publicly visible content is limited.")
    lines.push("")
    if (result.content) {
      lines.push("Visible content on the restriction page:")
      lines.push("")
      lines.push(result.content)
    }
    lines.push("")
    lines.push("---")
  } else {
    // Full visible content
    if (result.headings.length > 0) {
      for (const h of result.headings) {
        const prefix = "#".repeat(Math.min(h.level, 6))
        lines.push(`${prefix} ${h.text}`)
      }
      lines.push("")
    }

    if (result.content) {
      lines.push(result.content)
    } else {
      lines.push("(no visible content extracted)")
    }
  }

  return lines.join("\n")
}

/**
 * Scrape a high-security site using Scrapling's browser-based flow with
 * auto-scroll. Returns a formatted metadata result for TUI consumption.
 *
 * Flow:
 *   1. isScrapeEnabled() guard (caller responsibility)
 *   2. Detect high-security domain
 *   3. Crawl via crawlWithScrapling({ mode: "browser", scroll: true })
 *      - NO initial HTML fetch — goes straight to browser
 *   4. Browser opens the actual webpage
 *   5. Wait for rendering
 *   6. Auto-scroll the complete page (Python page_action)
 *   7. Wait for lazy-loaded/dynamic content
 *   8. Extract only the visible rendered page content
 *   9. Detect login walls / restrictions
 *   10. Return formatted metadata + content to TUI agent
 */
export async function scrapeHighSecuritySite(
  options: HighSecurityScrapeOptions,
): Promise<HighSecurityScrapeResult> {
  const { url, focus: _focus, timeoutMs = 90_000 } = options

  const crawlOptions: ScraplingCrawlOptions = {
    url,
    mode: "browser",
    scroll: true,
    timeoutMs,
  }

  // Crawl via Scrapling browser — NO initial HTML fetch
  const crawlResult = await crawlWithScrapling(crawlOptions)

  // Detect login walls / restrictions
  const loginWall = detectLoginWall(crawlResult)

  // Estimate scroll info from content
  const scrollInfo = estimateScrollInfo(crawlResult)

  // Determine status
  let status: HighSecurityScrapeDetails["status"]
  if (loginWall.detected) {
    status = "Restricted"
  } else if (crawlResult.success) {
    status = "Success"
  } else {
    status = "Failed"
  }

  // Extract visible content
  const visibleContent = crawlResult.content?.text ?? ""
  const headings = crawlResult.content?.headings ?? []
  const links = (crawlResult.links ?? []).map((l) => ({ text: l.text, url: l.url }))
  const title = crawlResult.page?.title ?? "Untitled"

  const result: HighSecurityScrapeResult = {
    metadata: {
      url,
      domain: extractDomain(url),
      scraper: "Scrapling",
      mode: "Browser",
      securityLevel: "High",
      rendered: true,
      autoScroll: true,
      contentType: "Visible Page",
      source: "TUI",
    },
    details: {
      initialHtmlFetch: false,
      browserNavigation: true,
      scrollIterations: scrollInfo.scrollIterations,
      dynamicContentLoaded: scrollInfo.dynamicContentLoaded,
      finalScrollHeight: scrollInfo.finalScrollHeight,
      status,
      error: crawlResult.error
        ? `${crawlResult.error.type}: ${crawlResult.error.message}`
        : undefined,
      loginWall,
    },
    title,
    content: visibleContent,
    headings,
    links,
    raw: crawlResult,
  }

  return result
}

// Self-reexport for namespace import compatibility
export * as HighSecurityScraper from "./high-security-scraper"
