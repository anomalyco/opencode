import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "./tool"
import { CRAWL_DISABLED_MESSAGE, isCrawlEnabled } from "@/cli/cmd/scrape-state"

const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to crawl" }),
  mode: Schema.optional(Schema.Literals(["http", "stealth", "browser"])).pipe(
    Schema.withDecodingDefault(Effect.succeed("http" as const)),
  ),
  timeout: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(30))),
  scroll: Schema.optional(Schema.Boolean).annotate({
    description: "Auto-scroll the page to load lazy content (browser/stealth modes only, default: false)",
  }),
})

export const CrawlTool = Tool.define(
  "crawl",
  Effect.succeed({
    description:
      "Crawl one permitted public URL using the standalone crawler. This tool is unavailable while the crawling agent is disabled.",
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        // Read this persisted state for every request, before permission or
        // transport selection. A disabled crawler cannot start a process or a
        // network request.
        if (!isCrawlEnabled()) {
          return { output: CRAWL_DISABLED_MESSAGE, title: "Crawl", metadata: {} }
        }
        if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
          throw new Error("URL must start with http:// or https://")
        }

        yield* ctx.ask({
          permission: "webfetch",
          patterns: [params.url],
          always: ["*"],
          metadata: { url: params.url, mode: params.mode, timeout: params.timeout },
        })

        const output = yield* Effect.tryPromise({
          try: () => crawlWithStandaloneCrawler(params.url, params.mode ?? "http", params.timeout ?? 30, params.scroll),
          catch: (error) => new Error(`Standalone crawler failed: ${error instanceof Error ? error.message : String(error)}`),
        })
        return { output, title: `${params.url} (standalone crawler)`, metadata: {} }
      }).pipe(Effect.orDie),
  }),
)

async function crawlWithStandaloneCrawler(url: string, mode: "http" | "stealth" | "browser", timeout: number, scroll?: boolean) {
  const script = path.resolve(import.meta.dirname, "../../../../standalone-crawler/crawler_cli.py")
  const crawlerRoot = path.dirname(script)
  const args = ["python", script, url, "--mode", mode, "--timeout", String(timeout), "--indent", "0"]
  if (scroll) args.push("--scroll")
  const child = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: crawlerRoot,
    env: { ...process.env, PYTHONPATH: [path.join(crawlerRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(stderr.trim() || `crawler exited with code ${exitCode}`)

  const result: unknown = JSON.parse(stdout)
  if (typeof result !== "object" || result === null) throw new Error("crawler returned an invalid response")
  const content = (result as { content?: { text?: unknown } }).content?.text
  return typeof content === "string" ? content : JSON.stringify(result)
}
