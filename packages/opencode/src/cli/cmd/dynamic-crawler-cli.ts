import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"

export const DynamicScrapeCommand = effectCmd({
  command: "scrape <url>",
  describe: "scrape a single URL using Chrome DevTools Protocol",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "URL to scrape",
        type: "string",
        demandOption: true,
      })
      .option("cookie", {
        describe: "session cookie string (name=value; name2=value2)",
        type: "string",
      })
      .option("cookie-file", {
        describe: "path to Netscape cookie file",
        type: "string",
      })
      .option("header", {
        describe: "custom header (key: value)",
        type: "string",
      })
      .option("output", {
        describe: "output directory",
        type: "string",
        default: "./dynamic-output",
      })
      .option("site-profile", {
        describe: "pre-configured site profile",
        choices: ["linkedin", "whatsapp", "instagram", "generic"] as const,
        default: "generic" as const,
      })
      .option("timeout", {
        describe: "page load timeout in ms",
        type: "number",
        default: 60000,
      })
      .option("wait-for", {
        describe: "wait time in ms after load",
        type: "number",
        default: 5000,
      })
      .option("wait-for-selector", {
        describe: "CSS selector to wait for",
        type: "string",
      })
      .option("retries", {
        describe: "retry count on failure",
        type: "number",
        default: 2,
      })
      .option("validate-auth", {
        describe: "check for auth walls before scraping",
        type: "boolean",
        default: false,
      })
      .option("godmode-fallback", {
        describe: "use GodMode as fallback when CDP extraction is incomplete",
        type: "boolean",
        default: true,
      })
      .option("no-godmode-fallback", {
        describe: "disable GodMode fallback",
        type: "boolean",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { dynamicScrapeHandler } = yield* Effect.promise(() => import("./dynamic-crawler.handler"))
      return yield* dynamicScrapeHandler(args)
    }),
})

export const DynamicCrawlCommand = effectCmd({
  command: "crawl <url>",
  describe: "crawl a website using Chrome DevTools Protocol",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "starting URL to crawl",
        type: "string",
        demandOption: true,
      })
      .option("cookie", {
        describe: "session cookie string (name=value; name2=value2)",
        type: "string",
      })
      .option("cookie-file", {
        describe: "path to Netscape cookie file",
        type: "string",
      })
      .option("header", {
        describe: "custom header (key: value)",
        type: "string",
      })
      .option("output", {
        describe: "output directory",
        type: "string",
        default: "./dynamic-output",
      })
      .option("site-profile", {
        describe: "pre-configured site profile",
        choices: ["linkedin", "whatsapp", "instagram", "generic"] as const,
        default: "generic" as const,
      })
      .option("timeout", {
        describe: "page load timeout in ms",
        type: "number",
        default: 60000,
      })
      .option("wait-for", {
        describe: "wait time in ms after load",
        type: "number",
        default: 5000,
      })
      .option("wait-for-selector", {
        describe: "CSS selector to wait for",
        type: "string",
      })
      .option("retries", {
        describe: "retry count on failure",
        type: "number",
        default: 2,
      })
      .option("validate-auth", {
        describe: "check for auth walls before scraping",
        type: "boolean",
        default: false,
      })
      .option("godmode-fallback", {
        describe: "use GodMode as fallback when CDP extraction is incomplete",
        type: "boolean",
        default: true,
      })
      .option("no-godmode-fallback", {
        describe: "disable GodMode fallback",
        type: "boolean",
      })
      .option("limit", {
        describe: "max pages to crawl",
        type: "number",
        default: 50,
      })
      .option("max-depth", {
        describe: "max crawl depth",
        type: "number",
      })
      .option("include-external-links", {
        describe: "follow links to external domains",
        type: "boolean",
        default: false,
      })
      .option("skip-patterns", {
        describe: "URL patterns to skip",
        type: "array",
        string: true,
        default: [] as string[],
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { dynamicCrawlHandler } = yield* Effect.promise(() => import("./dynamic-crawler.handler"))
      return yield* dynamicCrawlHandler(args)
    }),
})

export const DynamicCrawlerCommand = cmd({
  command: "dynamic",
  describe: "web scraping via raw Chrome DevTools Protocol",
  builder: (yargs) => yargs.command(DynamicScrapeCommand).command(DynamicCrawlCommand).demandCommand(),
  async handler() {},
})
