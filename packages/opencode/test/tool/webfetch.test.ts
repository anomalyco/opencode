import { afterAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Cause, Effect, Exit, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { CRAWL_DISABLED_MESSAGE, isCrawlEnabled, isScrapeEnabled, setCrawlState, setScrapeState, SCRAPE_DISABLED_MESSAGE } from "../../src/cli/cmd/scrape-state"

const stateDir = mkdtempSync(join(tmpdir(), "opencode-webfetch-test-"))
process.env.OPENCODE_STATE_DIR = stateDir

afterAll(() => rmSync(stateDir, { recursive: true, force: true }))

const it = testEffect(
  LayerNode.compile(LayerNode.group([httpClient, Truncate.node, Agent.node]), [
    [httpClient, FetchHttpClient.layer as Layer.Layer<HttpClient.HttpClient>],
  ]),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const withFetch = <A, E, R>(
  fetch: (req: Request) => Response | Promise<Response>,
  fn: (url: URL) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch })),
    (server) => fn(server.url),
    (server) => Effect.sync(() => server.stop(true)),
  )

const exec = Effect.fn("WebFetchToolTest.exec")(function* (args: Tool.InferParameters<typeof WebFetchTool>) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

describe("tool.webfetch", () => {
  it.instance("returns image responses as file attachments", () =>
    Effect.gen(function* () {
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setCrawlState(true)
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
        yield* withFetch(
          () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
          (url) =>
            Effect.gen(function* () {
              const result = yield* exec({ url: new URL("/image.png", url).toString(), format: "markdown" })
              expect(result.output).toBe("Image fetched successfully")
              expect(result.attachments).toBeDefined()
              expect(result.attachments?.length).toBe(1)
              expect(result.attachments?.[0].type).toBe("file")
              expect(result.attachments?.[0].mime).toBe("image/png")
              expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
              expect(result.attachments?.[0]).not.toHaveProperty("id")
              expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
              expect(result.attachments?.[0]).not.toHaveProperty("messageID")
            }),
        )
      } finally {
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )

  it.instance("keeps svg as text output", () =>
    Effect.gen(function* () {
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setCrawlState(true)
        yield* withFetch(
          () =>
            new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>', {
              status: 200,
              headers: { "content-type": "image/svg+xml; charset=UTF-8" },
            }),
          (url) =>
            Effect.gen(function* () {
              const result = yield* exec({ url: new URL("/image.svg", url).toString(), format: "html" })
              expect(result.output).toContain("<svg")
              expect(result.attachments).toBeUndefined()
            }),
        )
      } finally {
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )

  it.instance("keeps text responses as text output", () =>
    Effect.gen(function* () {
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setCrawlState(true)
        yield* withFetch(
          () =>
            new Response("hello from webfetch", {
              status: 200,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
          (url) =>
            Effect.gen(function* () {
              const result = yield* exec({ url: new URL("/file.txt", url).toString(), format: "text" })
              expect(result.output).toBe("hello from webfetch")
              expect(result.attachments).toBeUndefined()
            }),
        )
      } finally {
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )

  it.instance("extracts text from html without scripts or styles", () =>
    Effect.gen(function* () {
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setCrawlState(true)
        yield* withFetch(
          () =>
            new Response(
              "<html><head><style>.hidden{}</style><script>alert('x')</script></head><body>Hello <b>world</b></body></html>",
              {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" },
              },
            ),
          (url) =>
            Effect.gen(function* () {
              const result = yield* exec({ url: new URL("/page.html", url).toString(), format: "text" })
              expect(result.output).toBe("Hello world")
              expect(result.attachments).toBeUndefined()
            }),
        )
      } finally {
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )

  it.instance("blocks fetch when scraping is disabled", () =>
    Effect.gen(function* () {
      const wasEnabled = isScrapeEnabled()
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setCrawlState(true)
        setScrapeState(false)
        expect(isScrapeEnabled()).toBe(false)

        const result = yield* withFetch(
          () => new Response("should not reach here", { status: 200 }),
          (url) => exec({ url: new URL("/blocked", url).toString(), format: "text" }),
        )
        expect(result.output).toBe(SCRAPE_DISABLED_MESSAGE)
        expect(result.title).toBe("WebFetch")
      } finally {
        setScrapeState(wasEnabled)
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )

  it.instance("blocks fetch when crawl is disabled — regression for TUI using webfetch as crawl fallback", () =>
    Effect.gen(function* () {
      const wasCrawlEnabled = isCrawlEnabled()
      const wasScrapeEnabled = isScrapeEnabled()
      try {
        setCrawlState(false)
        setScrapeState(true)

        const result = yield* withFetch(
          () => new Response("should not reach here", { status: 200 }),
          (url) => exec({ url: new URL("/page", url).toString(), format: "text" }),
        )
        expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
        expect(result.title).toBe("WebFetch")
      } finally {
        setCrawlState(wasCrawlEnabled)
        setScrapeState(wasScrapeEnabled)
      }
    }),
  )

  it.instance("detects HTTP 999 and blocks the Scrapling fallback while crawling is disabled", () =>
    Effect.gen(function* () {
      const wasEnabled = isScrapeEnabled()
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setScrapeState(true)
        setCrawlState(false)
        const client = HttpClient.make((request) => {
          const response = HttpClientResponse.fromWeb(request, new Response("blocked", { status: 599 }))
          Object.defineProperty(response, "status", { value: 999 })
          return Effect.succeed(response)
        })
        const result = yield* exec({ url: "https://example.com", format: "text" }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        )
        expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
      } finally {
        setScrapeState(wasEnabled)
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )

  it.instance("launches the standalone crawler after HTTP 999 while crawling is enabled", () =>
    Effect.gen(function* () {
      const wasEnabled = isScrapeEnabled()
      const wasCrawlEnabled = isCrawlEnabled()
      try {
        setScrapeState(true)
        setCrawlState(true)
        const client = HttpClient.make((request) => {
          const response = HttpClientResponse.fromWeb(request, new Response("blocked", { status: 599 }))
          Object.defineProperty(response, "status", { value: 999 })
          return Effect.succeed(response)
        })
        const exit = yield* Effect.exit(
          exec({ url: "https://example.com", format: "text" }).pipe(Effect.provideService(HttpClient.HttpClient, client)),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const msg = Cause.pretty(exit.cause)
          // The subprocess was spawned — it fails because the Python env
          // is not set up. The exact error depends on installed packages.
          expect(msg).not.toContain("Crawling agent is disabled")
          expect(msg).toMatch(/pydantic|scrapling|python|crawler|ENOENT/i)
        }
      } finally {
        setScrapeState(wasEnabled)
        setCrawlState(wasCrawlEnabled)
      }
    }),
  )
})
