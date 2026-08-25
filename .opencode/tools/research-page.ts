import { tool } from "@opencode-ai/plugin"
import { crawlWithScrapling } from "../lib/scrapling-crawler"
import { formatPageResearch } from "../lib/page-research"

// Agent-facing web-research workflow: crawl a page via the local Scrapling
// crawler and present a research-ready digest. The agent reasons over the
// digest (summarize, answer questions, extract fields); the full structured
// CrawlResult stays available in metadata.

export default tool({
  description:
    "Research a web page: crawls it with the local Scrapling crawler (Python) and returns a structured research digest — main content, headings, deduplicated links, metadata — ready for summarization, Q&A or field extraction. Handles JavaScript-rendered pages when mode is stealth/browser.",

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
    const result = await crawlWithScrapling({ url, mode })
    const digest = formatPageResearch(result, { focus })

    return {
      title: typeof result.page?.title === "string" ? result.page.title : undefined,
      output: digest,
      metadata: { focus: focus ?? null, crawl: result },
    }
  },
})
