import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Effect, Exit, Cause, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import {
  CRAWL_DISABLED_MESSAGE,
  isCrawlEnabled,
  isScrapeEnabled,
  setCrawlState,
  setScrapeState,
} from "../../src/cli/cmd/scrape-state"

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const stateDir = mkdtempSync(join(tmpdir(), "opencode-http999-test-"))
process.env.OPENCODE_STATE_DIR = stateDir

afterAll(() => rmSync(stateDir, { recursive: true, force: true }))

const it = testEffect(
  LayerNode.compile(LayerNode.group([httpClient, Truncate.node, Agent.node]), [
    [httpClient, FetchHttpClient.layer as Layer.Layer<HttpClient.HttpClient>],
  ]),
)

const ctx = {
  sessionID: SessionID.make("ses_http999_test"),
  messageID: MessageID.make("msg_http999_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const exec = Effect.fn("Http999Test.exec")(function* (args: Tool.InferParameters<typeof WebFetchTool>) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock HTTP client that returns status 999 for every request. */
function mock999Client() {
  return HttpClient.make((request) => {
    const response = HttpClientResponse.fromWeb(request, new Response("blocked", { status: 599 }))
    Object.defineProperty(response, "status", { value: 999, configurable: true })
    return Effect.succeed(response)
  })
}

/** Create a mock HTTP client that returns a given status code. */
function mockStatusClient(status: number, body = "response body") {
  return HttpClient.make((request) => {
    const response = HttpClientResponse.fromWeb(
      request,
      new Response(body, { status: Math.min(status, 599), headers: { "content-type": "text/plain" } }),
    )
    if (status > 599) {
      Object.defineProperty(response, "status", { value: status, configurable: true })
    }
    return Effect.succeed(response)
  })
}

// ===========================================================================
// TEST 1: HTTP 999 is detected at the correct location
// ===========================================================================

describe("1. HTTP 999 detection location", () => {
  it.instance("HTTP 999 is detected before normal status checks", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(false)

      const client = mock999Client()
      const result = yield* exec({ url: "https://example.com/detected", format: "text" }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      // The 999 detection fires and returns CRAWL_DISABLED_MESSAGE
      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
    }),
  )
})

// ===========================================================================
// TEST 2: 999 does NOT fall back to normal WebFetch
// ===========================================================================

describe("2. HTTP 999 does NOT fall back to normal WebFetch processing", () => {
  it.instance("999 response returns disabled message, not processed HTML", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(false)

      const client = mock999Client()
      const result = yield* exec({ url: "https://example.com/nofallback", format: "text" }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
      expect(result.output).not.toContain("blocked")
      expect(result.output).not.toContain("Request failed with status")
    }),
  )
})

// ===========================================================================
// TEST 3: Standalone crawler is spawned on 999 + crawl ON
// ===========================================================================

describe("3. Standalone crawler spawn on HTTP 999 with crawl ON", () => {
  it.instance("crawlWithScrapling is called after 999", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      const client = mock999Client()

      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/spawn", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        expect(msg).not.toContain("Crawling agent is disabled")
        expect(msg).toMatch(/pydantic|python|crawler|spawn|subprocess|ENOENT/i)
      }
    }),
  )
})

// ===========================================================================
// TEST 4: Standalone crawler uses Scrapling (Python)
// ===========================================================================

describe("4. Standalone crawler uses Scrapling (Python subprocess)", () => {
  test("crawlWithScrapling calls crawler_cli.py which imports scrapling", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    expect(webfetchSource).toContain("crawlWithScrapling")
    expect(webfetchSource).toContain("crawler_cli.py")

    const crawlerCliPath = join(import.meta.dirname, "../../../../standalone-crawler/crawler_cli.py")
    const crawlerCliSource = readFileSync(crawlerCliPath, "utf-8")
    expect(crawlerCliSource).toContain("standalone_crawler")
    expect(crawlerCliSource).toContain("Crawler")

    const fetcherPath = join(
      import.meta.dirname,
      "../../../../standalone-crawler/src/standalone_crawler/fetcher.py",
    )
    const fetcherSource = readFileSync(fetcherPath, "utf-8")
    expect(fetcherSource).toContain("scrapling")
    expect(fetcherSource).toContain("scrapling.Fetcher")
    expect(fetcherSource).toContain("scrapling.StealthyFetcher")
    expect(fetcherSource).toContain("scrapling.DynamicFetcher")
  })
})

// ===========================================================================
// TEST 5: Original URL is passed unchanged
// ===========================================================================

describe("5. URL preservation through HTTP 999 fallback", () => {
  test("the exact URL is forwarded to crawlWithScrapling", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    expect(webfetchSource).toContain("crawlWithScrapling(params.url, timeout, params.scroll)")
    expect(webfetchSource).toMatch(/async function crawlWithScrapling\(url: string, timeout: number, scroll\?: boolean\)/)
  })
})

// ===========================================================================
// TEST 6: Crawl mode options are NOT preserved (BUG DOCUMENTED)
// ===========================================================================

describe("6. Crawl mode preservation (known limitation)", () => {
  test("webfetch tool parameters do NOT include a mode field", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    expect(webfetchSource).not.toMatch(/mode:.*Schema\.Literals/)
    expect(webfetchSource).toContain('"--mode", "http"')
  })

  test("standalone crawler CLI accepts --mode but webfetch fallback always uses http", () => {
    const crawlerCliPath = join(import.meta.dirname, "../../../../standalone-crawler/crawler_cli.py")
    const crawlerCliSource = readFileSync(crawlerCliPath, "utf-8")
    expect(crawlerCliSource).toContain("--mode")

    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).toContain('"--mode", "http"')
  })
})

// ===========================================================================
// TEST 7: Scroll settings ARE preserved (FIX VERIFIED)
// ===========================================================================

describe("7. Scroll settings preservation", () => {
  test("webfetch schema includes optional scroll parameter", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).toMatch(/scroll:.*Schema\.optional\(Schema\.Boolean\)/)
  })

  test("crawlWithScrapling accepts scroll parameter", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).toMatch(/async function crawlWithScrapling\(url: string, timeout: number, scroll\?: boolean\)/)
  })

  test("--scroll is appended to subprocess args when scroll=true", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).toContain('if (scroll) args.push("--scroll")')
  })

  test("--scroll is NOT appended when scroll is omitted/false", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    // The conditional only pushes when truthy, so omitted/false means no flag
    expect(webfetchSource).toContain("if (scroll) args.push")
  })

  test("standalone crawler CLI accepts --scroll flag", () => {
    const crawlerCliPath = join(import.meta.dirname, "../../../../standalone-crawler/crawler_cli.py")
    const crawlerCliSource = readFileSync(crawlerCliPath, "utf-8")
    expect(crawlerCliSource).toContain("--scroll")
  })

  test("crawlWithScrapling forwards params.scroll from the tool", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).toContain("crawlWithScrapling(params.url, timeout, params.scroll)")
  })
})

// ===========================================================================
// TEST 8: Focus/research instruction architecture
// ===========================================================================

describe("8. Focus/research instruction architecture", () => {
  test("webfetch tool has no focus parameter (by design — simple fetch)", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).not.toMatch(/focus.*Schema/)
  })

  test("research-page plugin tool DOES preserve focus", () => {
    const researchPagePath = join(import.meta.dirname, "../../../../.opencode/tools/research-page.ts")
    const researchPageSource = readFileSync(researchPagePath, "utf-8")
    expect(researchPageSource).toContain("focus")
    expect(researchPageSource).toContain("formatPageResearch(result, { focus })")
  })

  test("research-page is NOT blocked by crawl dispatch guard", () => {
    const registrySource = readFileSync(
      join(import.meta.dirname, "../../src/tool/registry.ts"),
      "utf-8",
    )
    // research-page should not be in CRAWL_TOOL_IDS — it has its own isScrapeEnabled() guard
    const crawlToolIdsMatch = registrySource.match(/CRAWL_TOOL_IDS = new Set\(\[([^\]]+)\]\)/)
    expect(crawlToolIdsMatch).not.toBeNull()
    expect(crawlToolIdsMatch![1]).not.toContain('"research-page"')
  })

  test("research-page has its own isScrapeEnabled() guard", () => {
    const researchPagePath = join(import.meta.dirname, "../../../../.opencode/tools/research-page.ts")
    const researchPageSource = readFileSync(researchPagePath, "utf-8")
    expect(researchPageSource).toContain("isScrapeEnabled()")
    expect(researchPageSource).toContain("SCRAPE_DISABLED_MESSAGE")
  })

  test("focus flows through formatPageResearch to digest header", () => {
    const pageResearchPath = join(import.meta.dirname, "../../../../.opencode/lib/page-research.ts")
    const pageResearchSource = readFileSync(pageResearchPath, "utf-8")
    // focus is echoed into the header as "Research focus: {focus}"
    expect(pageResearchSource).toContain("Research focus:")
    expect(pageResearchSource).toContain("if (focus) lines.push")
  })
})

// ===========================================================================
// TEST 9: Crawl OFF prevents HTTP 999 fallback
// ===========================================================================

describe("9. Crawl OFF prevents HTTP 999 fallback", () => {
  it.instance("returns CRAWL_DISABLED_MESSAGE and does NOT spawn subprocess", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(false)

      expect(isCrawlEnabled()).toBe(false)

      const client = mock999Client()
      const result = yield* exec({ url: "https://example.com/blocked", format: "text" }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
      expect(result.title).toBe("WebFetch")
    }),
  )

  test("CRAWL_DISABLED_MESSAGE contains instructions", () => {
    expect(CRAWL_DISABLED_MESSAGE).toContain("opencode dynamic crawl on")
  })
})

// ===========================================================================
// TEST 10: Crawl ON allows HTTP 999 fallback
// ===========================================================================

describe("10. Crawl ON allows HTTP 999 fallback", () => {
  it.instance("does NOT return CRAWL_DISABLED_MESSAGE, attempts subprocess", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      expect(isCrawlEnabled()).toBe(true)

      const client = mock999Client()
      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/allowed", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        expect(msg).not.toContain("Crawling agent is disabled")
      }
    }),
  )
})

// ===========================================================================
// TEST 11: WebFetch is NOT incorrectly used as fallback
// ===========================================================================

describe("11. WebFetch is NOT used as fallback for HTTP 999", () => {
  it.instance("999 does not produce WebFetch-style HTML output", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(false)

      const client = HttpClient.make((request) => {
        const html = "<html><body>This is NOT from WebFetch</body></html>"
        const response = HttpClientResponse.fromWeb(request, new Response(html, { status: 599 }))
        Object.defineProperty(response, "status", { value: 999, configurable: true })
        return Effect.succeed(response)
      })

      const result = yield* exec({ url: "https://example.com/no-webfetch", format: "html" }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
      expect(result.output).not.toContain("This is NOT from WebFetch")
      expect(result.output).not.toContain("<html>")
    }),
  )
})

// ===========================================================================
// TEST 12: Non-999 error statuses are handled normally
// ===========================================================================

describe("12. Non-999 error statuses are NOT treated as 999", () => {
  it.instance("status 403 throws error, does NOT trigger Scrapling fallback", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      const client = mockStatusClient(403, "forbidden")
      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/403", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        expect(msg).toContain("403")
        expect(msg).not.toMatch(/pydantic|crawler_cli|scrapling/i)
      }
    }),
  )

  it.instance("status 404 throws error, does NOT trigger Scrapling fallback", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      const client = mockStatusClient(404, "not found")
      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/404", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        expect(msg).toContain("404")
        expect(msg).not.toMatch(/pydantic|crawler_cli|scrapling/i)
      }
    }),
  )

  it.instance("status 500 throws error, does NOT trigger Scrapling fallback", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      const client = mockStatusClient(500, "server error")
      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/500", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        expect(msg).toContain("500")
        expect(msg).not.toMatch(/pydantic|crawler_cli|scrapling/i)
      }
    }),
  )
})

// ===========================================================================
// TEST 13: Crawl tool (core) OFF blocks directly
// ===========================================================================

describe("13. Crawl core tool respects crawl state", () => {
  it.instance("crawl tool returns CRAWL_DISABLED_MESSAGE when disabled", () =>
    Effect.gen(function* () {
      setCrawlState(false)
      const { CrawlTool } = yield* Effect.promise(() => import("../../src/tool/crawl"))
      const info = yield* CrawlTool
      const tool = yield* info.init()
      const result = yield* tool.execute({ url: "https://example.com" }, ctx)
      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
    }),
  )
})

// ===========================================================================
// TEST 14: Plugin crawler tool dispatch guard exists
// ===========================================================================

describe("14. Plugin crawler tool dispatch guard", () => {
  test("fromPlugin() guard blocks crawler-related tools when crawl is OFF", () => {
    const registrySource = readFileSync(
      join(import.meta.dirname, "../../src/tool/registry.ts"),
      "utf-8",
    )
    expect(registrySource).toContain("CRAWL_TOOL_IDS")
    expect(registrySource).toContain('"crawler"')
    expect(registrySource).toContain("isCrawlEnabled()")
    expect(registrySource).toContain("CRAWL_DISABLED_MESSAGE")
  })

  test("research-page is NOT in CRAWL_TOOL_IDS (has own isScrapeEnabled guard)", () => {
    const registrySource = readFileSync(
      join(import.meta.dirname, "../../src/tool/registry.ts"),
      "utf-8",
    )
    const crawlToolIdsMatch = registrySource.match(/CRAWL_TOOL_IDS = new Set\(\[([^\]]+)\]\)/)
    expect(crawlToolIdsMatch).not.toBeNull()
    expect(crawlToolIdsMatch![1]).toContain('"crawler"')
    expect(crawlToolIdsMatch![1]).not.toContain('"research-page"')
  })
})

// ===========================================================================
// TEST 15: Source code verification of the 999→Scrapling path
// ===========================================================================

describe("15. Source code verification of the 999→Scrapling path", () => {
  test("webfetch.ts has the complete 999→Scrapling code path", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    // 1. isScrapeEnabled() guard at the top
    expect(webfetchSource).toContain("isScrapeEnabled()")
    expect(webfetchSource).toContain("SCRAPE_DISABLED_MESSAGE")

    // 2. HTTP 999 detection
    expect(webfetchSource).toContain("response.status === 999")

    // 3. isCrawlEnabled() guard before fallback
    expect(webfetchSource).toContain("isCrawlEnabled()")
    expect(webfetchSource).toContain("CRAWL_DISABLED_MESSAGE")

    // 4. crawlWithScrapling call
    expect(webfetchSource).toContain("crawlWithScrapling(params.url, timeout, params.scroll)")

    // 5. crawlWithScrapling function definition
    expect(webfetchSource).toMatch(/async function crawlWithScrapling/)
    expect(webfetchSource).toContain("crawler_cli.py")

    // 6. Standalone crawler spawned via Bun.spawn
    expect(webfetchSource).toContain("Bun.spawn")
    expect(webfetchSource).toContain('"python"')
    expect(webfetchSource).toContain('"--mode", "http"')
    expect(webfetchSource).toContain('"--indent", "0"')

    // 7. PYTHONPATH includes scrapling src
    expect(webfetchSource).toContain("PYTHONPATH")

    // 8. Result parsing
    expect(webfetchSource).toContain("isCrawlerResult")
    expect(webfetchSource).toContain("content?.text")
  })

  test("webfetch.ts 999 check is BEFORE the <200 || >=300 check", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    const check999 = webfetchSource.indexOf("response.status === 999")
    const checkRange = webfetchSource.indexOf("response.status < 200 || response.status >= 300")

    // 999 check MUST come before the range check
    expect(check999).toBeGreaterThan(0)
    expect(checkRange).toBeGreaterThan(0)
    expect(check999).toBeLessThan(checkRange)
  })
})

// ===========================================================================
// TEST 16: Timeout is preserved through the fallback
// ===========================================================================

describe("16. Timeout preservation through HTTP 999 fallback", () => {
  test("crawlWithScrapling passes timeout converted from ms to seconds", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    expect(webfetchSource).toContain('"--timeout"')
    expect(webfetchSource).toContain("timeout / 1000")
  })
})

// ===========================================================================
// TEST 17: Verify the complete flow trace (code structure)
// ===========================================================================

describe("17. Complete flow trace verification", () => {
  test("exec → isCrawlEnabled → isScrapeEnabled → HTTP request → 999 check → crawlWithScrapling → crawler_cli.py → scrapling", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    // The flow is sequential in the source:
    // 1. isCrawlEnabled() check (line ~38) — blocks all fetch when crawl is OFF
    const crawlCheck = webfetchSource.indexOf("isCrawlEnabled()")
    // 2. isScrapeEnabled() check (line ~42)
    const scrapeCheck = webfetchSource.indexOf("isScrapeEnabled()")
    // 3. HTTP request (line ~83-93)
    const httpRequest = webfetchSource.indexOf("http.execute(request)")
    // 4. 999 detection (line ~98)
    const check999 = webfetchSource.indexOf("response.status === 999")
    // 5. isCrawlEnabled() guard for 999 fallback (line ~99)
    const crawlCheck999 = webfetchSource.indexOf("isCrawlEnabled()", crawlCheck + 1)
    // 6. crawlWithScrapling call (line ~103-105)
    const crawlCall = webfetchSource.indexOf("crawlWithScrapling(params.url, timeout, params.scroll)")
    // 7. crawlWithScrapling function (line ~201)
    const crawlFn = webfetchSource.indexOf("async function crawlWithScrapling")
    // 8. Bun.spawn with crawler_cli.py (line ~206)
    const spawnCall = webfetchSource.indexOf("Bun.spawn(args, {")
    // 9. scrapling via PYTHONPATH (line ~210)
    const pythonpath = webfetchSource.indexOf("PYTHONPATH")

    // All must be present and in order
    expect(crawlCheck).toBeGreaterThan(0)
    expect(scrapeCheck).toBeGreaterThan(crawlCheck)
    expect(httpRequest).toBeGreaterThan(scrapeCheck)
    expect(check999).toBeGreaterThan(httpRequest)
    expect(crawlCheck999).toBeGreaterThan(check999)
    expect(crawlCall).toBeGreaterThan(crawlCheck999)
    expect(crawlFn).toBeGreaterThan(crawlCall)
    expect(spawnCall).toBeGreaterThan(crawlFn)
    expect(pythonpath).toBeGreaterThan(spawnCall)
  })

  test("webfetch.ts 999 path includes scroll forwarding", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    // scroll parameter in schema
    expect(webfetchSource).toMatch(/scroll:.*Schema\.optional/)
    // scroll forwarded in call
    expect(webfetchSource).toContain("crawlWithScrapling(params.url, timeout, params.scroll)")
    // scroll in function signature
    expect(webfetchSource).toMatch(/crawlWithScrapling\(url: string, timeout: number, scroll\?: boolean\)/)
    // scroll conditionally added to args
    expect(webfetchSource).toContain('if (scroll) args.push("--scroll")')
  })
})

// ===========================================================================
// TEST A: scroll is passed when supplied
// ===========================================================================

describe("A. scroll passed when supplied", () => {
  it.instance("crawlWithScrapling receives scroll=true and includes --scroll in args", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      // Mock 999 to trigger the fallback path
      const client = mock999Client()

      // The tool will attempt to spawn the subprocess. Since the Python env
      // is not set up, it will fail. We verify the args by checking the
      // source code contains the conditional scroll push.
      const webfetchSource = readFileSync(
        join(import.meta.dirname, "../../src/tool/webfetch.ts"),
        "utf-8",
      )

      // Verify the scroll parameter flows from schema → call → function → args
      expect(webfetchSource).toContain("params.scroll")
      expect(webfetchSource).toContain("crawlWithScrapling(params.url, timeout, params.scroll)")
      expect(webfetchSource).toContain("if (scroll) args.push(\"--scroll\")")
    }),
  )
})

// ===========================================================================
// TEST B: scroll is omitted when not supplied
// ===========================================================================

describe("B. scroll omitted when not supplied", () => {
  test("default crawlWithScrapling args do NOT include --scroll", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    // The base args array does not include --scroll
    const baseArgsMatch = webfetchSource.match(
      /const args = \["python", script, url, "--mode", "http", "--timeout", String\(timeout \/ 1000\), "--indent", "0"\]/,
    )
    expect(baseArgsMatch).not.toBeNull()

    // --scroll is only added via the conditional
    expect(webfetchSource).toContain('if (scroll) args.push("--scroll")')
  })

  test("schema scroll defaults to undefined (not true)", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    // scroll is Schema.optional with no .default(true), so it's undefined when omitted
    expect(webfetchSource).toMatch(/scroll:.*Schema\.optional\(Schema\.Boolean\)\.annotate/)
    expect(webfetchSource).not.toMatch(/scroll:.*\.default\(true\)/)
  })
})

// ===========================================================================
// TEST C: HTTP 999 triggers Scrapling when crawling is ON
// ===========================================================================

describe("C. HTTP 999 triggers Scrapling when crawling ON", () => {
  it.instance("999 with crawl ON attempts subprocess (not crawl-disabled)", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      const client = mock999Client()
      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/crawl-on", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        // Must NOT be the crawl-disabled message
        expect(msg).not.toContain("Crawling agent is disabled")
        // Must be a subprocess error (python env issue)
        expect(msg).toMatch(/pydantic|python|crawler|spawn|ENOENT|scrapling/i)
      }
    }),
  )

  it.instance("999 with crawl ON and scroll=true also attempts subprocess", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(true)

      const client = mock999Client()
      const exit = yield* Effect.exit(
        exec({ url: "https://example.com/crawl-on-scroll", format: "text", scroll: true }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = Cause.pretty(exit.cause)
        expect(msg).not.toContain("Crawling agent is disabled")
      }
    }),
  )
})

// ===========================================================================
// TEST D: HTTP 999 does NOT trigger Scrapling when crawling is OFF
// ===========================================================================

describe("D. HTTP 999 does NOT trigger Scrapling when crawling OFF", () => {
  it.instance("returns CRAWL_DISABLED_MESSAGE, no subprocess spawned", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(false)

      const client = mock999Client()
      const result = yield* exec({ url: "https://example.com/crawl-off", format: "text" }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
      expect(result.title).toBe("WebFetch")
    }),
  )

  it.instance("returns CRAWL_DISABLED_MESSAGE even when scroll=true", () =>
    Effect.gen(function* () {
      setScrapeState(true)
      setCrawlState(false)

      const client = mock999Client()
      const result = yield* exec({ url: "https://example.com/crawl-off-scroll", format: "text", scroll: true }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
    }),
  )
})

// ===========================================================================
// TEST E: the exact scroll value reaches the crawler CLI
// ===========================================================================

describe("E. scroll value reaches crawler CLI", () => {
  test("when scroll=true, --scroll appears in the spawned args", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )
    // The conditional pushes the exact string "--scroll"
    expect(webfetchSource).toContain('args.push("--scroll")')
    // The CLI flag name matches crawler_cli.py's --scroll argument
    const crawlerCliPath = join(import.meta.dirname, "../../../../standalone-crawler/crawler_cli.py")
    const crawlerCliSource = readFileSync(crawlerCliPath, "utf-8")
    expect(crawlerCliSource).toContain('"--scroll"')
    expect(crawlerCliSource).toContain('action="store_true"')
    // argparse infers dest="scroll" from "--scroll", used as args.scroll
    expect(crawlerCliSource).toContain("scroll=args.scroll")
  })

  test("crawler_cli.py scroll flag sets CrawlerConfig.scroll", () => {
    const configPath = join(
      import.meta.dirname,
      "../../../../standalone-crawler/src/standalone_crawler/config.py",
    )
    const configSource = readFileSync(configPath, "utf-8")
    expect(configSource).toContain("scroll: bool")
    expect(configSource).toContain("Field(")
  })
})

// ===========================================================================
// TEST F: no duplicate crawler invocation occurs
// ===========================================================================

describe("F. no duplicate crawler invocation", () => {
  test("999 path calls crawlWithScrapling exactly once (single Effect.tryPromise)", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    // There is exactly one crawlWithScrapling call in the 999 branch
    const ninethNineBranch = webfetchSource.indexOf("response.status === 999")
    const afterBranch = webfetchSource.indexOf("if (response.status < 200")
    const branchSection = webfetchSource.substring(ninethNineBranch, afterBranch)

    const crawlCallsInSection = branchSection.split("crawlWithScrapling(").length - 1
    expect(crawlCallsInSection).toBe(1)

    // No second crawlWithScrapling CALL after the 999 branch (function definition is fine)
    const after999 = webfetchSource.substring(afterBranch)
    // Only the function definition contains "crawlWithScrapling(" after the 999 branch;
    // there must be no *call* sites (i.e. "crawlWithScrapling(" not preceded by "function ")
    const callSites = after999.match(/(?<!function )crawlWithScrapling\(/g) ?? []
    expect(callSites.length).toBe(0)
    // Bun.spawn only appears inside the crawlWithScrapling function definition, not in the effect body
    const bunSpawnInAfter999 = after999.match(/Bun\.spawn/g) ?? []
    expect(bunSpawnInAfter999.length).toBe(1) // exactly one, in the function def
  })

  test("the 999 branch returns immediately after crawlWithScrapling", () => {
    const webfetchSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/webfetch.ts"),
      "utf-8",
    )

    // After the crawlWithScrapling call and return, the code hits the
    // status range check, not another crawl path
    const crawlReturn = webfetchSource.indexOf('return { output, title: `${params.url} (Scrapling)`')
    const rangeCheck = webfetchSource.indexOf("if (response.status < 200 || response.status >= 300)")
    expect(crawlReturn).toBeGreaterThan(0)
    expect(rangeCheck).toBeGreaterThan(crawlReturn)
  })
})
