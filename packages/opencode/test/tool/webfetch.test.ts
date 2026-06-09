import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { selectWebFetchProvider, WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { failureMessage, withEnv, withIflowServer } from "./iflow-test-util"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer))

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
  it.instance("selects default provider unless iFlow is explicitly configured", () =>
    Effect.sync(() => {
      const original = process.env.OPENCODE_WEBFETCH_PROVIDER
      delete process.env.OPENCODE_WEBFETCH_PROVIDER
      try {
        expect(selectWebFetchProvider()).toBe("default")
        process.env.OPENCODE_WEBFETCH_PROVIDER = "iflow"
        expect(selectWebFetchProvider()).toBe("iflow")
      } finally {
        if (original === undefined) delete process.env.OPENCODE_WEBFETCH_PROVIDER
        else process.env.OPENCODE_WEBFETCH_PROVIDER = original
      }
    }),
  )

  it.instance("requires IFLOW_API_KEY when iFlow provider is explicitly configured", () =>
    withEnv(
      { OPENCODE_WEBFETCH_PROVIDER: "iflow", IFLOW_API_KEY: undefined, IFLOW_BASE_URL: "https://example.com" },
      Effect.gen(function* () {
        const message = yield* failureMessage(exec({ url: "https://example.com/docs", format: "markdown" }))
        expect(message).toContain("IFLOW_API_KEY is required when OPENCODE_WEBFETCH_PROVIDER=iflow.")
      }),
    ),
  )

  it.instance("calls iFlow webFetch when iFlow provider is explicitly configured", () =>
    Effect.gen(function* () {
      let called = false

      const result = yield* withIflowServer(
        async (request) => {
          called = true
          expect(new URL(request.url).pathname).toBe("/api/search/webFetch")
          const body = (await request.json()) as Record<string, unknown>
          expect(body.url).toBe("https://example.com/docs")
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                title: "Fetched Page",
                url: "https://example.com/docs",
                content: "Fetched through iFlow",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        },
        (url) =>
          withEnv(
            {
              OPENCODE_WEBFETCH_PROVIDER: "iflow",
              IFLOW_API_KEY: "mock-credential",
              IFLOW_BASE_URL: url.toString(),
            },
            exec({ url: "https://example.com/docs", format: "markdown" }),
          ),
      )

      expect(called).toBe(true)
      expect(result.metadata.provider).toBe("iflow")
      expect(result.output).toContain("Title: Fetched Page")
      expect(result.output).toContain("Content:\nFetched through iFlow")
    }),
  )

  it.instance("returns image responses as file attachments", () =>
    Effect.gen(function* () {
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
    }),
  )

  it.instance("keeps svg as text output", () =>
    withFetch(
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
    ),
  )

  it.instance("keeps text responses as text output", () =>
    withFetch(
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
    ),
  )

  it.instance("extracts text from html without scripts or styles", () =>
    withFetch(
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
    ),
  )
})
