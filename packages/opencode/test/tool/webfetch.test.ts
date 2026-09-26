import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Exit, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { assertAllowedUrl, isBlockedAddress, WebFetchTool } from "../../src/tool/webfetch"
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
  extra: { bypassNetworkCheck: true },
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

const exec = Effect.fn("WebFetchToolTest.exec")(function* (
  args: Tool.InferParameters<typeof WebFetchTool>,
  context: typeof ctx = ctx,
) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, context)
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

  it.instance("rejects a blocked address before fetching", () =>
    Effect.gen(function* () {
      const info = yield* WebFetchTool
      const tool = yield* info.init()
      const exit = yield* tool
        .execute({ url: "http://169.254.169.254/latest/meta-data/", format: "text" }, { ...ctx, extra: {} })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("follows a redirect chain up to the cap", () =>
    Effect.gen(function* () {
      yield* withFetch(
        (req) => {
          const n = Number(new URL(req.url).pathname.slice(1))
          if (Number.isInteger(n) && n > 0) return Response.redirect(new URL(`/${n - 1}`, req.url).toString(), 302)
          return new Response("redirected", { status: 200, headers: { "content-type": "text/plain" } })
        },
        (url) =>
          Effect.gen(function* () {
            const ok = yield* exec({ url: new URL("/3", url).toString(), format: "text" })
            expect(ok.output).toBe("redirected")

            const exit = yield* exec({ url: new URL("/5", url).toString(), format: "text" }).pipe(Effect.exit)
            expect(Exit.isFailure(exit)).toBe(true)
          }),
      )
    }),
  )

  test("isBlockedAddress classifies private and metadata ranges", () => {
    const blocked = [
      "127.0.0.1",
      "::1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "::ffff:127.0.0.1",
      "fe80::1",
      "fd00::1",
      "224.0.0.1",
      "::ffff:7f00:1",
      "::ffff:a00:1",
      "::ffff:a9fe:a9fe",
      "0:0:0:0:0:0:0:1",
      "fec0::1",
      "64:ff9b::7f00:1",
      "198.18.0.1",
      "192.0.0.1",
      "192.0.2.1",
    ]
    for (const address of blocked) expect(isBlockedAddress(address)).toBe(true)
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808"])
      expect(isBlockedAddress(address)).toBe(false)
  })

  test("assertAllowedUrl rejects metadata and loopback literals", async () => {
    await expect(assertAllowedUrl("http://169.254.169.254/")).rejects.toThrow()
    await expect(assertAllowedUrl("http://127.0.0.1:8080/")).rejects.toThrow()
    await expect(assertAllowedUrl("http://[::1]/")).rejects.toThrow()
    await expect(assertAllowedUrl("http://[::ffff:7f00:1]/")).rejects.toThrow()
    await expect(assertAllowedUrl("http://[0:0:0:0:0:0:0:1]/")).rejects.toThrow()
    await expect(assertAllowedUrl("http://[::ffff:a9fe:a9fe]/")).rejects.toThrow()
    await expect(assertAllowedUrl("http://[fec0::1]/")).rejects.toThrow()
  })

  it.instance("rejects a response body larger than the cap", () =>
    withFetch(
      () => {
        const chunk = new Uint8Array(1024 * 1024)
        let sent = 0
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (sent >= 6) return controller.close()
              sent++
              controller.enqueue(chunk)
            },
          }),
          { status: 200, headers: { "content-type": "text/plain" } },
        )
      },
      (url) =>
        Effect.gen(function* () {
          const exit = yield* exec({ url: new URL("/big.txt", url).toString(), format: "text" }).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
    ),
  )

  it.instance("asks permission before resolving the target host", () =>
    Effect.gen(function* () {
      const info = yield* WebFetchTool
      const tool = yield* info.init()
      let asked = false
      const exit = yield* tool
        .execute(
          { url: "http://169.254.169.254/latest/meta-data/", format: "text" },
          {
            ...ctx,
            extra: {},
            ask: () =>
              Effect.sync(() => {
                asked = true
              }),
          },
        )
        .pipe(Effect.exit)
      expect(asked).toBe(true)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
