import { tool } from "@opencode-ai/plugin"
import { crawlWithScrapling } from "../lib/scrapling-crawler"

// Agent-facing tool over the shared Scrapling client. All spawning,
// validation and parsing live in ../lib/scrapling-crawler.ts; the Python
// project owns crawling/extraction. See C:/projects/crawler/README.md.

export default tool({
  description:
    "Crawl a webpage using the local Scrapling crawler (Python). Supports http, stealth and browser modes. Returns structured JSON: status, title, headings, paragraphs, links, images, metadata.",

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
    const result = await crawlWithScrapling({ url, mode })

    const title = typeof result.page?.title === "string" ? result.page.title : undefined

    return {
      title,
      output: JSON.stringify(result),
      metadata: result,
    }
  },
})
