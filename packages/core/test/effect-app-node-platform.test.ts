import { describe, expect, test } from "bun:test"
import { WebSocketTransport } from "@opencode-ai/ai/route"
import { WebSocketConstructor } from "@opencode-ai/core/effect/websocket-constructor"
import { Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"

const makeServer = (fetch: (request: Request, server: Bun.Server<undefined>) => Response | undefined) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch,
        websocket: { message() {} },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )

describe("WebSocket network policy", () => {
  test("uses protocol-specific and standard proxy variables", () => {
    expect(
      WebSocketConstructor.proxy("wss://provider.test/responses", {
        WSS_PROXY: "http://wss-proxy.test",
        HTTPS_PROXY: "http://https-proxy.test",
      }),
    ).toBe("http://wss-proxy.test")
    expect(
      WebSocketConstructor.proxy("wss://provider.test/responses", { HTTPS_PROXY: "http://https-proxy.test" }),
    ).toBe("http://https-proxy.test")
    expect(WebSocketConstructor.proxy("ws://provider.test/responses", { HTTP_PROXY: "http://http-proxy.test" })).toBe(
      "http://http-proxy.test",
    )
    expect(WebSocketConstructor.proxy("ws://provider.test/responses", { ALL_PROXY: "http://all-proxy.test" })).toBe(
      "http://all-proxy.test",
    )
  })

  test("respects no-proxy hosts, domains, ports, and wildcards", () => {
    const environment = { HTTPS_PROXY: "http://proxy.test" }
    expect(
      WebSocketConstructor.proxy("wss://provider.test/responses", { ...environment, NO_PROXY: "provider.test" }),
    ).toBeUndefined()
    expect(
      WebSocketConstructor.proxy("wss://api.provider.test/responses", { ...environment, NO_PROXY: ".provider.test" }),
    ).toBeUndefined()
    expect(
      WebSocketConstructor.proxy("wss://provider.test:8443/responses", {
        ...environment,
        NO_PROXY: "provider.test:443",
      }),
    ).toBe("http://proxy.test")
    expect(
      WebSocketConstructor.proxy("wss://provider.test/responses", { ...environment, NO_PROXY: "*" }),
    ).toBeUndefined()
  })

  test("rejects redirects without forwarding authorization", async () => {
    let destinationRequests = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const destination = yield* makeServer((request, server) => {
          destinationRequests++
          if (server.upgrade(request)) return undefined
          return new Response("upgrade failed", { status: 426 })
        })
        const redirect = yield* makeServer(
          () =>
            new Response(null, {
              status: 302,
              headers: { location: destination.url.toString().replace(/^http/, "ws") },
            }),
        )
        const constructor = yield* Socket.WebSocketConstructor

        yield* WebSocketTransport.open({
          url: redirect.url.toString().replace(/^http/, "ws"),
          headers: Headers.fromInput({ authorization: "Bearer secret" }),
        }).pipe(Effect.provideService(Socket.WebSocketConstructor, constructor), Effect.flip)

        expect(destinationRequests).toBe(0)
      }).pipe(Effect.scoped, Effect.provide(WebSocketConstructor.layer)),
    )
  })
})
