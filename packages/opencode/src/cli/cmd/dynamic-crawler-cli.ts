import { Effect } from "effect"
import { cmd } from "./cmd"
import { CliError, effectCmd } from "../effect-cmd"
import { ScrapeCommand } from "./crawl"
import { CRAWL_DISABLED_MESSAGE, isCrawlEnabled, setCrawlState } from "./scrape-state"

export const DynamicCrawlCommand = cmd({
  command: "crawl <urlOrState>",
  describe: "crawl a website using Chrome DevTools Protocol",
  builder: (yargs) =>
    yargs
      .positional("urlOrState", {
        describe: "starting URL to crawl, or on/off to enable/disable the crawling agent",
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
        describe: "pre-configured site profile; automatically detected from the URL when omitted",
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
  async handler(args) {
    if (args.urlOrState === "on") {
      setCrawlState(true)
      process.stderr.write("Crawling agent enabled.\n")
      return
    }
    if (args.urlOrState === "off") {
      setCrawlState(false)
      process.stderr.write("Crawling agent disabled.\n")
      return
    }
    // This check precedes loading the crawler implementation, so a disabled
    // agent cannot select or initialize any crawler transport.
    if (!isCrawlEnabled()) throw new CliError({ message: CRAWL_DISABLED_MESSAGE })
    const { dynamicCrawlHandler } = await import("./dynamic-crawler.handler")
    await Effect.runPromise(dynamicCrawlHandler({ ...args, url: args.urlOrState }))
  },
})

export const DynamicFetchCommand = effectCmd({
  command: "fetch <url>",
  describe: "fetch a public page via HTTP (no browser required)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "URL to fetch",
        type: "string",
        demandOption: true,
      })
      .option("header", {
        describe: "custom header (key: value)",
        type: "string",
      })
      .option("output", {
        describe: "output directory",
        type: "string",
        default: "./fetch-output",
      })
      .option("timeout", {
        describe: "request timeout in ms",
        type: "number",
        default: 30000,
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { dynamicFetchHandler } = yield* Effect.promise(() => import("./dynamic-crawler.handler"))
      return yield* dynamicFetchHandler(args)
    }),
})

export const DynamicCrawlerCommand = cmd({
  command: "dynamic",
  describe: "web scraping via HTTP or Chrome DevTools Protocol",
  builder: (yargs) =>
    yargs.command(DynamicFetchCommand).command(ScrapeCommand).command(DynamicCrawlCommand).demandCommand(),
  async handler() {},
})
