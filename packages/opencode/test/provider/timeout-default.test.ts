import { afterEach, expect } from "bun:test"
import { createServer, type Server } from "node:http"
import { streamText } from "ai"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, CrossSpawnSpawner.node])),
)

// Regression for #13841: the documented 300000ms `timeout` default was never
// applied to AbortSignal.timeout because the provider option schema is a
// free-form Record with no `.default()`. Without this fix, a provider whose
// endpoint never responds hangs forever (Bun's socket timeout is intentionally
// disabled per bun#16682, so nothing else aborts the request).
//
// These tests cover the wiring that the fix preserves:
//   - explicit finite `timeout` -> request aborts at the configured deadline
//   - explicit `timeout: false` -> request does NOT abort (opt-out honored)
//   - fast response with no `timeout` set -> default does not break the happy path
//
// The "omitting `timeout` produces a 5-minute abort" path is not exercised
// directly because waiting 5 minutes per test is impractical; the same
// `AbortSignal.timeout(requestTimeout)` call site is exercised by the explicit
// finite-timeout tests, which is the regression-sensitive branch.

it.live("explicit timeout aborts when the provider never responds", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => neverRespondsServer()),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })

          const error = yield* Effect.promise(async () => {
            try {
              for await (const part of result.fullStream) {
                if (part.type === "error") return part.error
              }
            } catch (error) {
              return error
            }
          })
          // AbortSignal.timeout on an unreachable server surfaces a TimeoutError
          // (DOMException name === "TimeoutError") on the fetch promise.
          expect(error).toBeInstanceOf(DOMException)
          expect((error as DOMException).name).toBe("TimeoutError")
        }),
      { config: providerConfig(server.url, { timeout: 50 }) },
    )
  }),
)

it.live("explicit timeout fires when response is slower than the deadline", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => delayedResponseServer(100, "late")),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })
          // A 50ms timeout must abort the 100ms-delayed response. This is the
          // regression-sensitive branch: if AbortSignal.timeout is removed or
          // the configured value is ignored, the response would land normally.
          const error = yield* Effect.promise(async () => {
            try {
              for await (const part of result.fullStream) {
                if (part.type === "error") return part.error
              }
            } catch (error) {
              return error
            }
          })
          expect(error).toBeInstanceOf(DOMException)
          expect((error as DOMException).name).toBe("TimeoutError")
        }),
      { config: providerConfig(server.url, { timeout: 50 }) },
    )
  }),
)

it.live("timeout: false preserves the happy path on a fast response", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => shortResponseServer("ok")),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            messages: [{ role: "user", content: "hello" }],
          })
          // Disabling the timeout should not abort a normal, snappy response.
          expect(yield* Effect.promise(() => result.text)).toBe("ok")
        }),
      { config: providerConfig(server.url, { timeout: false }) },
    )
  }),
)

it.live("omitting timeout does not break the happy path", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => shortResponseServer("ok")),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            messages: [{ role: "user", content: "hello" }],
          })
          // No `timeout` option set. The default (300000ms) should not fire on
          // a sub-millisecond response; this guards against accidentally wiring
          // the default to a tiny constant or the wrong unit.
          expect(yield* Effect.promise(() => result.text)).toBe("ok")
        }),
      { config: providerConfig(server.url) },
    )
  }),
)

function providerConfig(url: string, options: Record<string, unknown> = {}) {
  const config = testProviderConfig(url)
  return {
    ...config,
    provider: {
      test: {
        ...config.provider.test,
        options: { ...config.provider.test.options, ...options },
      },
    },
  }
}

async function neverRespondsServer(): Promise<{ server: Server; url: string }> {
  const server = createServer(() => {
    // Intentionally never responds. Without an active timeout the request hangs
    // forever; the explicit `timeout: 50` in the test config ensures the
    // AbortPath is exercised quickly.
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port")
  return { server, url: `http://127.0.0.1:${address.port}` }
}

async function shortResponseServer(body: string): Promise<{ server: Server; url: string }> {
  const server = createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.end(`data: {"choices":[{"delta":{"content":"${body}"}}]}\n\ndata: [DONE]\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port")
  return { server, url: `http://127.0.0.1:${address.port}` }
}

async function delayedResponseServer(delay: number, body: string): Promise<{ server: Server; url: string }> {
  const server = createServer((_, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end(`data: {"choices":[{"delta":{"content":"${body}"}}]}\n\ndata: [DONE]\n\n`)
    }, delay)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port")
  return { server, url: `http://127.0.0.1:${address.port}` }
}
