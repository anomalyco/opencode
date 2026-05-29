import { afterEach, expect } from "bun:test"
import { createServer, type Server } from "node:http"
import { streamText } from "ai"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ProviderError } from "@/provider/error"
import { ModelID, ProviderID } from "@/provider/schema"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(
    Provider.defaultLayer,
    Env.defaultLayer,
    Plugin.defaultLayer,
    TestLLMServer.layer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

it.live("headerTimeout does not abort delayed SSE body after headers arrive", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        yield* llm.push(reply().wait(Bun.sleep(250)).text("late").stop())

        const provider = yield* Provider.Service
        const model = yield* provider.getModel(ProviderID.make("test"), ModelID.make("test-model"))
        const result = streamText({
          model: yield* provider.getLanguage(model),
          messages: [{ role: "user", content: "hello" }],
        })

        expect(yield* Effect.promise(() => result.text)).toBe("late")
      }),
    {
      config: (url) => {
        const config = testProviderConfig(url)
        return {
          ...config,
          provider: {
            test: {
              ...config.provider.test,
              options: { ...config.provider.test.options, headerTimeout: 50 },
            },
          },
        }
      },
    },
  ),
)

it.live("chunkTimeout raises a response stream error when SSE body stalls", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        yield* llm.push(reply().wait(Bun.sleep(250)).text("late").stop())

        const provider = yield* Provider.Service
        const model = yield* provider.getModel(ProviderID.make("test"), ModelID.make("test-model"))
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
        expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
      }),
    { config: (url) => providerConfig(url, { chunkTimeout: 50 }) },
  ),
)

it.live("headerTimeout aborts when response headers do not arrive", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => delayedHeaderServer(250)),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderID.make("test"), ModelID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })

          const errors = yield* Effect.promise(async () => {
            const errors: string[] = []
            for await (const part of result.fullStream) {
              if (part.type === "error") errors.push(String(part.error))
            }
            return errors
          })
          expect(errors.join("\n")).toContain("response headers timed out")
        }),
      { config: providerConfig(server.url, { headerTimeout: 50 }) },
    )
  }),
)

it.live("headerTimeout is opt-in for non-OpenAI providers", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => delayedHeaderServer(100)),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderID.make("test"), ModelID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            messages: [{ role: "user", content: "hello" }],
          })

          expect(yield* Effect.promise(() => result.text)).toBe("ok")
        }),
      { config: providerConfig(server.url) },
    )
  }),
)

it.live("OpenAI Codex headerTimeout default can be disabled by config", () =>
  Effect.gen(function* () {
    yield* withAuthContent(
      Effect.gen(function* () {
        yield* provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const provider = yield* Provider.Service
              const openai = yield* provider.getProvider(ProviderID.openai)
              expect(openai.options.headerTimeout).toBe(false)
            }),
          { config: { provider: { openai: { options: { headerTimeout: false } } } } },
        )
      }),
    )
  }),
)

it.live("OpenAI API auth gets default headerTimeout", () =>
  Effect.gen(function* () {
    yield* withAuthContent(
      Effect.gen(function* () {
        yield* provideTmpdirInstance(() =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const openai = yield* provider.getProvider(ProviderID.openai)
            expect(openai.options.headerTimeout).toBe(10_000)
          }),
        )
      }),
      { openai: { type: "api", key: "sk-test" } },
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

async function delayedHeaderServer(delay: number): Promise<{ server: Server; url: string }> {
  const server = createServer((_, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
    }, delay)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port")
  return { server, url: `http://127.0.0.1:${address.port}` }
}

function withAuthContent<A, E, R>(self: Effect.Effect<A, E, R>, value: Record<string, unknown> = defaultAuthContent()) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_AUTH_CONTENT
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify(value)
      return previous
    }),
    () => self,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
        else process.env.OPENCODE_AUTH_CONTENT = previous
      }),
  )
}

function defaultAuthContent() {
  return {
    openai: { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 60_000 },
  }
}
