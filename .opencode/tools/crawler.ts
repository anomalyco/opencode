import { tool } from "@opencode-ai/plugin"
import { crawlWithScrapling } from "../lib/scrapling-crawler"
import { isScrapeEnabled, SCRAPE_DISABLED_MESSAGE } from "../../packages/opencode/src/cli/cmd/scrape-state"
import {
  isHighSecuritySite,
  scrapeHighSecuritySite,
  formatHighSecurityResult,
} from "../lib/high-security-scraper"

// Agent-facing tool over the shared Scrapling client. All spawning,
// validation and parsing live in ../lib/scrapling-crawler.ts; the Python
// project owns crawling/extraction. See C:/projects/crawler/README.md.
//
// For high-security sites, this tool:
//   1. Detects the high-security domain
//   2. Skips initial HTML fetch — goes straight to Scrapling browser
//   3. Opens the actual webpage via browser
//   4. Waits for rendering
//   5. Auto-scrolls the complete page
//   6. Waits for lazy-loaded/dynamic content
//   7. Extracts only the visible rendered page content
//   8. Returns a clean metadata format (not raw JSON)

export default tool({
  description:
    "Crawl a webpage using the local Scrapling crawler (Python). Supports http, stealth and browser modes. Returns structured JSON: status, title, headings, paragraphs, links, images, metadata. For high-security sites, automatically uses browser-based scraping with auto-scroll and returns a clean metadata format.",

  args: {
    url: tool.schema.string().url().describe("The URL to crawl"),

    mode: tool.schema
      .enum(["http", "stealth", "browser"])
      .optional()
      .default("stealth")
      .describe(
        "http: plain requests, stealth: anti-bot browser, browser: Playwright browser",
      ),
  },

  async execute({ url, mode = "stealth" }) {
    if (!isScrapeEnabled()) {
      return { output: SCRAPE_DISABLED_MESSAGE }
    }

    // Route high-security sites to browser-based Scrapling with auto-scroll
    // NO initial HTML fetch — goes straight to Scrapling browser
    if (isHighSecuritySite(url)) {
      const result = await scrapeHighSecuritySite({ url })
      const formatted = formatHighSecurityResult(result)

      return {
        title: result.title,
        output: formatted,
        metadata: {
          highSecurity: true,
          scraper: "Scrapling",
          mode: "Browser",
          securityLevel: "High",
          status: result.details.status,
          loginWallDetected: result.details.loginWall?.detected ?? false,
          crawl: result.raw,
        },
        rawText: result.content,
      }
    }

    // Normal path: standard Scrapling crawl
    const result = await crawlWithScrapling({ url, mode })

    const title = typeof result.page?.title === "string" ? result.page.title : undefined

    return {
      title,
      output: JSON.stringify(result),
      metadata: result,
      rawText: result.content?.text ?? "",
    }
  },
})
