import { tool } from "@opencode-ai/plugin"
import { crawlWithScrapling } from "../lib/scrapling-crawler"
import { formatPageResearch } from "../lib/page-research"
import { isScrapeEnabled, SCRAPE_DISABLED_MESSAGE } from "../../packages/opencode/src/cli/cmd/scrape-state"
import {
  isHighSecuritySite,
  scrapeHighSecuritySite,
  formatHighSecurityResult,
} from "../lib/high-security-scraper"

// Agent-facing web-research workflow: crawl a page via the local Scrapling
// crawler and present a research-ready digest. The agent reasons over the
// digest (summarize, answer questions, extract fields); the full structured
// CrawlResult stays available in metadata.
//
// For high-security sites (LinkedIn, etc.), the tool:
//   1. Detects the high-security domain
//   2. Skips initial HTML fetch — goes straight to Scrapling browser
//   3. Opens the actual webpage via browser
//   4. Waits for rendering
//   5. Auto-scrolls the complete page
//   6. Waits for lazy-loaded/dynamic content
//   7. Extracts only the visible rendered page content
//   8. Returns a clean metadata format (not raw JSON)
//
// The agent MUST use the Scrapling result when it succeeds — do NOT fall
// back to WebFetch or research-page after Scrapling returns content.

export default tool({
  description:
    "Research a web page: crawls it with the local Scrapling crawler (Python) and returns a structured research digest — main content, headings, deduplicated links, metadata — ready for summarization, Q&A or field extraction. Handles JavaScript-rendered pages when mode is stealth/browser. For high-security sites (LinkedIn, etc.), automatically uses browser-based scraping with auto-scroll and returns a clean metadata format.",

  args: {
    url: tool.schema.string().url().describe("The URL to crawl"),

    mode: tool.schema
      .enum(["http", "stealth", "browser"])
      .optional()
      .default("stealth")
      .describe(
        "http: plain requests (fastest), stealth: anti-bot browser with JS rendering (default), browser: Playwright browser with JS rendering",
      ),

    focus: tool.schema
      .string()
      .optional()
      .describe(
        "Optional extraction/research instruction, e.g. 'extract pricing fields' or 'answer: what license does this project use?'",
      ),
  },

  async execute({ url, mode = "stealth", focus }) {
    // Scrape state guard MUST run before ANY browser/network activity
    if (!isScrapeEnabled()) {
      return { output: SCRAPE_DISABLED_MESSAGE }
    }

    // Route high-security sites to the browser-based scraper with auto-scroll
    // NO initial HTML fetch — goes straight to Scrapling browser
    const useHighSecurityPath = isHighSecuritySite(url)

    if (useHighSecurityPath) {
      // High-security path: Scrapling browser → render → auto-scroll → extract
      const result = await scrapeHighSecuritySite({ url, focus })

      // Format as clean metadata — NOT raw JSON
      const formatted = formatHighSecurityResult(result)

      return {
        title: result.title,
        output: formatted,
        metadata: {
          highSecurity: true,
          scraper: "Scrapling",
          mode: "Browser",
          securityLevel: "High",
          rendered: true,
          autoScroll: true,
          status: result.details.status,
          loginWallDetected: result.details.loginWall?.detected ?? false,
          crawl: result.raw,
        },
      }
    }

    // Normal path: standard Scrapling crawl
    const result = await crawlWithScrapling({ url, mode })
    const digest = formatPageResearch(result, { focus })

    return {
      title: typeof result.page?.title === "string" ? result.page.title : undefined,
      output: digest,
      metadata: { focus: focus ?? null, crawl: result, highSecurity: false },
    }
  },
})
