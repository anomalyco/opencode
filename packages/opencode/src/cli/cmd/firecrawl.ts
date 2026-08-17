import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"

export const FirecrawlScrapeCommand = effectCmd({
  command: "scrape <url>",
  describe: "scrape a single URL using Firecrawl SDK",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "URL to scrape",
        type: "string",
        demandOption: true,
      })
      .option("output", {
        describe: "output directory",
        type: "string",
        default: "./firecrawl-output",
      })
      .option("formats", {
        describe: "output formats",
        choices: ["markdown", "html", "both"] as const,
        default: "markdown" as const,
      })
      .option("timeout", {
        describe: "request timeout in ms",
        type: "number",
        default: 30000,
      })
      .option("wait-for-selector", {
        describe: "CSS selector to wait for before extracting",
        type: "string",
      })
      .option("only-main-content", {
        describe: "extract only main content",
        type: "boolean",
        default: true,
      })
      .option("provider", {
        describe: "provider to use",
        choices: ["firecrawl", "auto"] as const,
        default: "firecrawl" as const,
      })
      .option("cookie", {
        describe: "session cookie string",
        type: "string",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { firecrawlScrapeHandler } = yield* Effect.promise(() => import("./firecrawl.handler"))
      return yield* firecrawlScrapeHandler(args)
    }),
})

export const FirecrawlCrawlCommand = effectCmd({
  command: "crawl <url>",
  describe: "crawl a website using Firecrawl SDK",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "starting URL to crawl",
        type: "string",
        demandOption: true,
      })
      .option("output", {
        describe: "output directory",
        type: "string",
        default: "./firecrawl-output",
      })
      .option("limit", {
        describe: "max pages to crawl",
        type: "number",
        default: 50,
      })
      .option("max-depth", {
        describe: "max crawl depth",
        type: "number",
        default: 2,
      })
      .option("formats", {
        describe: "output formats",
        choices: ["markdown", "html", "both"] as const,
        default: "markdown" as const,
      })
      .option("timeout", {
        describe: "request timeout in ms",
        type: "number",
        default: 30000,
      })
      .option("exclude-patterns", {
        describe: "URL patterns to skip",
        type: "array",
        string: true,
        default: [] as string[],
      })
      .option("provider", {
        describe: "provider to use",
        choices: ["firecrawl", "auto"] as const,
        default: "firecrawl" as const,
      })
      .option("cookie", {
        describe: "session cookie string",
        type: "string",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { firecrawlCrawlHandler } = yield* Effect.promise(() => import("./firecrawl.handler"))
      return yield* firecrawlCrawlHandler(args)
    }),
})

export const FirecrawlSdkCommand = cmd({
  command: "firecrawl-sdk",
  describe: "web scraping using Firecrawl SDK",
  builder: (yargs) => yargs.command(FirecrawlScrapeCommand).command(FirecrawlCrawlCommand).demandCommand(),
  async handler() {},
})
