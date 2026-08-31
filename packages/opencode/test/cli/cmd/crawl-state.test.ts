import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { join } from "path"
import { DynamicCrawlCommand } from "../../../src/cli/cmd/dynamic-crawler-cli"
import { ScrapeCommand } from "../../../src/cli/cmd/crawl"
import { dynamicCrawlHandler } from "../../../src/cli/cmd/dynamic-crawler.handler"
import { firecrawlCrawlHandler } from "../../../src/cli/cmd/firecrawl.handler"
import {
  CRAWL_DISABLED_MESSAGE,
  isCrawlEnabled,
  isScrapeEnabled,
  setCrawlState,
  setScrapeState,
} from "../../../src/cli/cmd/scrape-state"

process.env.OPENCODE_STATE_DIR = join(import.meta.dir, ".crawl-state-test")

const originalCrawlState = isCrawlEnabled()
const originalScrapeState = isScrapeEnabled()

afterAll(() => {
  setCrawlState(originalCrawlState)
  setScrapeState(originalScrapeState)
})

const crawlArgs = {
  url: "not-a-url",
  output: "./dynamic-output",
  "site-profile": "generic" as const,
  timeout: 1,
  "wait-for": 0,
  retries: 0,
  "validate-auth": false,
  limit: 1,
  "include-external-links": false,
  "skip-patterns": [],
}

function commandArgs(urlOrState: string) {
  return {
    ...crawlArgs,
    urlOrState,
    cookie: undefined,
    "cookie-file": undefined,
    cookieFile: undefined,
    header: undefined,
    siteProfile: "generic" as const,
    waitFor: 0,
    "wait-for-selector": undefined,
    waitForSelector: undefined,
    validateAuth: false,
    "max-depth": undefined,
    maxDepth: undefined,
    includeExternalLinks: false,
    skipPatterns: [],
    _: [],
    $0: "opencode",
  }
}

describe("dynamic crawl state", () => {
  it("enables the crawling agent with dynamic crawl on", async () => {
    setCrawlState(false)

    await DynamicCrawlCommand.handler(commandArgs("on"))

    expect(isCrawlEnabled()).toBe(true)
  })

  it("disables the crawling agent with dynamic crawl off", async () => {
    setCrawlState(true)

    await DynamicCrawlCommand.handler(commandArgs("off"))

    expect(isCrawlEnabled()).toBe(false)
  })

  it("blocks a TUI crawl request before the crawler is selected", async () => {
    setCrawlState(false)
    setScrapeState(true)

    await expect(Effect.runPromise(dynamicCrawlHandler(crawlArgs))).rejects.toMatchObject({
      message: CRAWL_DISABLED_MESSAGE,
    })
  })

  it("blocks Firecrawl before its SDK can initialize", async () => {
    setCrawlState(false)

    await expect(
      Effect.runPromise(
        firecrawlCrawlHandler({
          url: "https://example.com",
          output: "./firecrawl-output",
          limit: 1,
          "max-depth": 1,
          formats: "markdown",
          timeout: 1,
          "exclude-patterns": [],
          provider: "firecrawl",
        }),
      ),
    ).rejects.toMatchObject({ message: CRAWL_DISABLED_MESSAGE })
  })

  it("blocks Firecrawl scrape when crawl is disabled", async () => {
    setCrawlState(false)

    const { firecrawlScrapeHandler } = await import("../../../src/cli/cmd/firecrawl.handler")

    await expect(
      Effect.runPromise(
        firecrawlScrapeHandler({
          url: "https://example.com",
          output: "./firecrawl-output",
          formats: "markdown",
          timeout: 1,
          "only-main-content": false,
          provider: "firecrawl",
        }),
      ),
    ).rejects.toMatchObject({ message: CRAWL_DISABLED_MESSAGE })
  })

  it("allows the crawl flow to proceed when enabled", async () => {
    setCrawlState(true)
    setScrapeState(true)

    await expect(Effect.runPromise(dynamicCrawlHandler(crawlArgs))).rejects.not.toMatchObject({
      message: CRAWL_DISABLED_MESSAGE,
    })
  })

  it("blocks dynamic scrape when crawl is disabled", async () => {
    setCrawlState(false)
    setScrapeState(true)

    const scrapeArgs = {
      stateOrUrl: "https://example.com",
      urls: [],
      browser: false,
      output: "./scrape-output",
      "max-chars": 20000,
      scroll: true,
      "max-scrolls": 50,
      login: false,
      format: "zip" as const,
      maxChars: 20000,
      maxScrolls: 50,
      _: [],
      $0: "opencode",
    } as any

    await expect(ScrapeCommand.handler(scrapeArgs)).rejects.toMatchObject({
      message: CRAWL_DISABLED_MESSAGE,
    })
  })

  it("dynamic scrape on enables both scrape and crawl state", async () => {
    setCrawlState(false)
    setScrapeState(false)

    await ScrapeCommand.handler({
      stateOrUrl: "on",
      urls: [],
      browser: false,
      output: "./scrape-output",
      "max-chars": 20000,
      scroll: true,
      "max-scrolls": 50,
      login: false,
      format: "zip",
      maxChars: 20000,
      maxScrolls: 50,
      _: [],
      $0: "opencode",
    } as any)

    expect(isCrawlEnabled()).toBe(true)
    expect(isScrapeEnabled()).toBe(true)
  })

  it("dynamic scrape off disables both scrape and crawl state", async () => {
    setCrawlState(true)
    setScrapeState(true)

    await ScrapeCommand.handler({
      stateOrUrl: "off",
      urls: [],
      browser: false,
      output: "./scrape-output",
      "max-chars": 20000,
      scroll: true,
      "max-scrolls": 50,
      login: false,
      format: "zip",
      maxChars: 20000,
      maxScrolls: 50,
      _: [],
      $0: "opencode",
    } as any)

    expect(isCrawlEnabled()).toBe(false)
    expect(isScrapeEnabled()).toBe(false)
  })
})
