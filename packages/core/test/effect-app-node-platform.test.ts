import { describe, expect, test } from "bun:test"
import type { BunPlugin } from "bun"
import { join } from "node:path"
import { WebSocketTransport } from "@opencode/ai/route"
import { WebSocketConstructor } from "@opencode/core/effect/websocket-constructor"
import { Effect } from "effect"
import { Headers } from "effect/http"
import { Socket } from "effect/socket"
import { layer } from "../src/effect/websocket-constructor/websocket-constructor.workerd.js"

const externalizeBare: BunPlugin = {
  name: "externalize-bare",
  setup(build) {
    build.onResolve({ filter: /^[^.#/]/ }, (args) => ({ path: args.path, external: true }))
  },
}

const bundle = async (conditions: Array<string>) => {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "../src/effect/websocket-constructor.ts")],
    target: "browser",
    conditions,
    plugins: [externalizeBare],
    throw: false,
  })
  expect(result.logs).toEqual([])
  expect(result.success).toBe(true)
  return result.outputs[0].text()
}

const makeServer = (
  fetch: (request: Request, server: Bun.Server<undefined>) => Response | undefined,
  websocket: Bun.WebSocketHandler<undefined> = { message() {} },
) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch,
        websocket,
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

describe("workerd WebSocketConstructor", () => {
  test("uses globalThis.WebSocket and rejects handshake header options", async () => {
    const protocols: Array<string | null> = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(
          (request, srv) => {
            const protocol = request.headers.get("sec-websocket-protocol")
            protocols.push(protocol)
            if (srv.upgrade(request, protocol ? { headers: { "sec-websocket-protocol": protocol } } : undefined))
              return undefined
            return new Response("upgrade failed", { status: 426 })
          },
          {
            open(ws) {
              ws.send("hello")
            },
            message() {},
          },
        )
        const url = server.url.toString().replace(/^http/, "ws")
        const constructor = yield* Socket.WebSocketConstructor

        const direct = yield* Effect.acquireRelease(
          Effect.sync(() => constructor(url)),
          (ws) => Effect.sync(() => ws.close(1000)),
        )
        expect(direct).toBeInstanceOf(globalThis.WebSocket)

        const socket = yield* Socket.makeWebSocket(url, { protocols: "chat" })
        const reader = yield* socket.reader
        const frames = yield* reader.pull
        const first = frames[0]
        expect(typeof first === "string" ? first : new TextDecoder().decode(first)).toBe("hello")
        expect(protocols).toContain("chat")

        expect(() => constructor(url, { headers: { authorization: "Bearer secret" } })).toThrow(TypeError)
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
  })
})

// Skipped on Windows: Bun.build inside `bun test` panics Bun 1.3.14 on Windows
// (see sqlite-bundle.test.ts). Package.json condition resolution is platform-independent.
describe.skipIf(process.platform === "win32")("websocket-constructor bundle conditions", () => {
  test("workerd conditions use global WebSocket without Node ws or proxy agents", async () => {
    const output = await bundle(["workerd"])
    expect(output).not.toContain("@effect/platform-node/NodeWS")
    expect(output).not.toContain("http-proxy-agent")
    expect(output).not.toContain("https-proxy-agent")
    expect(output).toContain("layerWebSocketConstructorGlobal")
  })

  test("bun conditions use Bun WebSocket without Node ws or proxy agents", async () => {
    const output = await bundle(["bun"])
    expect(output).not.toContain("@effect/platform-node/NodeWS")
    expect(output).not.toContain("http-proxy-agent")
    expect(output).not.toContain("https-proxy-agent")
    expect(output).toContain("globalThis.WebSocket")
  })

  test.each([[["node"]], [[]]])("%p conditions select NodeWS and proxy agents", async (conditions) => {
    const output = await bundle(conditions)
    expect(output).toContain("@effect/platform-node/NodeWS")
    expect(output).toContain("http-proxy-agent")
    expect(output).toContain("https-proxy-agent")
  })
})
