import { afterAll, beforeAll, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"

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

const withoutAllowPrivate = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      delete process.env.AIXPLAIN_CODE_WEBFETCH_ALLOW_PRIVATE
    }),
    () => self,
    () =>
      Effect.sync(() => {
        process.env.AIXPLAIN_CODE_WEBFETCH_ALLOW_PRIVATE = "1"
      }),
  )

const ORIGINAL_ALLOW_PRIVATE = process.env.AIXPLAIN_CODE_WEBFETCH_ALLOW_PRIVATE

beforeAll(() => {
  // The localhost fixtures below spin up real servers; the SSRF guard would block them by default
  process.env.AIXPLAIN_CODE_WEBFETCH_ALLOW_PRIVATE = "1"
})

afterAll(() => {
  if (ORIGINAL_ALLOW_PRIVATE === undefined) delete process.env.AIXPLAIN_CODE_WEBFETCH_ALLOW_PRIVATE
  else process.env.AIXPLAIN_CODE_WEBFETCH_ALLOW_PRIVATE = ORIGINAL_ALLOW_PRIVATE
})

describe("tool.webfetch", () => {
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

  it.instance("blocks loopback targets even when a server is listening", () =>
    withoutAllowPrivate(
      withFetch(
        () => new Response("secret", { status: 200, headers: { "content-type": "text/plain" } }),
        (url) =>
          Effect.gen(function* () {
            // url is http://localhost:<port>/ of a LIVE server — the guard must fire before any connection
            const exit = yield* exec({ url: new URL("/file.txt", url).toString(), format: "text" }).pipe(Effect.exit)
            expect(exit._tag).toBe("Failure")
            if (exit._tag === "Failure") {
              expect(String(exit.cause)).toContain("private/internal")
            }
          }),
      ),
    ),
  )

  it.instance("follows redirects across allowed servers", () =>
    withFetch(
      (req) => {
        const url = new URL(req.url)
        if (url.pathname === "/start") return Response.redirect(new URL("/final", url).toString(), 302)
        return new Response("reached final", { status: 200, headers: { "content-type": "text/plain" } })
      },
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/start", url).toString(), format: "text" })
          expect(result.output).toBe("reached final")
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
