import { afterEach, expect } from "bun:test"
import { createServer, type Server } from "node:http"
import { APICallError, streamText } from "ai"
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
import { ProviderError } from "@/provider/error"
import { MessageV2 } from "@/session/message-v2"
import { SessionRetry } from "@/session/retry"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, CrossSpawnSpawner.node])),
)

it.live("headerTimeout does not abort delayed SSE body after headers arrive", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => delayedBodyServer(1_000)),
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

          expect(yield* Effect.promise(() => result.text)).toBe("late")
        }),
      { config: providerConfig(server.url, { headerTimeout: 500 }) },
    )
  }),
)

it.live("chunkTimeout applies to a headerless stream before its first event", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => localBodyServer({ end: false })),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          const result = streamText({
            model: yield* provider.getLanguage(model),
            abortSignal: abort.signal,
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })

          const error = yield* Effect.promise(() => readStreamError(result, abort))
          expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { chunkTimeout: 50 }) },
    )
  }),
)

it.live("chunkTimeout applies after reasoning begins without a content type", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          chunks: [{ delay: 0, body: event({ choices: [{ delta: { reasoning_content: "thinking" } }] }) }],
          end: false,
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          let sawReasoning = false
          const result = streamText({
            model: yield* provider.getLanguage(model),
            abortSignal: abort.signal,
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })

          const error = yield* Effect.promise(async () => {
            const timeout = setTimeout(() => abort.abort(new Error("bounded test timeout")), 2_000)
            try {
              for await (const part of result.fullStream) {
                if (part.type === "reasoning-delta") sawReasoning = true
                if (part.type === "error") return part.error
              }
              return new Error("stream completed without an error")
            } catch (error) {
              return error
            } finally {
              clearTimeout(timeout)
            }
          })

          expect(sawReasoning).toBe(true)
          expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { chunkTimeout: 50 }) },
    )
  }),
)

for (const contentType of ["application/json", "not-a-mime-type"]) {
  it.live(`chunkTimeout applies to an SSE body with a misleading content type (${contentType})`, () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          localBodyServer({
            contentType,
            chunks: [{ delay: 0, body: event({ choices: [{ delta: { content: "partial" } }] }) }],
            end: false,
          }),
        ),
        (server) => Effect.promise(() => closeServer(server.server)),
      )

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
            const abort = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (controller) => Effect.sync(() => controller.abort()),
            )
            let sawText = false
            const result = streamText({
              model: yield* provider.getLanguage(model),
              abortSignal: abort.signal,
              onError() {},
              messages: [{ role: "user", content: "hello" }],
            })

            const error = yield* Effect.promise(async () => {
              const timeout = setTimeout(() => abort.abort(new Error("bounded test timeout")), 2_000)
              try {
                for await (const part of result.fullStream) {
                  if (part.type === "text-delta") {
                    expect(part.text).toBe("partial")
                    sawText = true
                  }
                  if (part.type === "error") {
                    expect(sawText).toBe(true)
                    return part.error
                  }
                }
                return new Error("stream completed without an error")
              } catch (error) {
                expect(sawText).toBe(true)
                return error
              } finally {
                clearTimeout(timeout)
              }
            })

            expect(sawText).toBe(true)
            expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
            expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
          }),
        { config: providerConfig(server.url, { chunkTimeout: 50 }) },
      )
    }),
  )
}

it.live("body progress resets chunkTimeout across multiple timeout intervals", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          contentType: "text/event-stream",
          chunks: [
            { delay: 0, body: event({ choices: [{ delta: { role: "assistant" } }] }) },
            { delay: 200, body: event({ choices: [{ delta: { content: "a" } }] }) },
            { delay: 200, body: event({ choices: [{ delta: { content: "b" } }] }) },
            { delay: 200, body: "data: [DONE]\n\n" },
          ],
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
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

          const text: string[] = []
          yield* Effect.promise(async () => {
            for await (const part of result.fullStream) {
              if (part.type === "text-delta") text.push(part.text)
              if (part.type === "error") throw part.error
            }
          })
          expect(text.join("")).toBe("ab")
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { chunkTimeout: 500 }) },
    )
  }),
)

it.live("Bedrock binary EventStream progress survives multiple timeout intervals", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          contentType: "application/vnd.amazon.eventstream",
          chunks: [
            {
              delay: 0,
              body: bedrockEvent("contentBlockDelta", {
                contentBlockIndex: 0,
                delta: { text: "a" },
              }),
            },
            {
              delay: 200,
              body: bedrockEvent("contentBlockDelta", {
                contentBlockIndex: 0,
                delta: { text: "b" },
              }),
            },
            { delay: 200, body: bedrockEvent("messageStop", { stopReason: "end_turn" }) },
            {
              delay: 200,
              body: bedrockEvent("metadata", {
                usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
              }),
            },
          ],
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
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

          expect(yield* Effect.promise(() => result.text)).toBe("ab")
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: bedrockProviderConfig(server.url, { chunkTimeout: 500 }) },
    )
  }),
)

it.live("chunkTimeout applies to a stalled binary EventStream body", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          contentType: "application/vnd.amazon.eventstream",
          chunks: [
            {
              delay: 0,
              body: bedrockEvent("contentBlockDelta", {
                contentBlockIndex: 0,
                delta: { text: "partial" },
              }),
            },
          ],
          end: false,
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          let sawText = false
          const result = streamText({
            model: yield* provider.getLanguage(model),
            abortSignal: abort.signal,
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })
          const error = yield* Effect.promise(async () => {
            const timeout = setTimeout(() => abort.abort(new Error("bounded test timeout")), 2_000)
            try {
              for await (const part of result.fullStream) {
                if (part.type === "text-delta") sawText = true
                if (part.type === "error") return part.error
              }
              return new Error("stream completed without an error")
            } catch (error) {
              return error
            } finally {
              clearTimeout(timeout)
            }
          })

          expect(sawText).toBe(true)
          expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: bedrockProviderConfig(server.url, { chunkTimeout: 50 }) },
    )
  }),
)

it.live("timeout false does not disable chunkTimeout", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => localBodyServer({ end: false })),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const configured = yield* provider.getProvider(ProviderV2.ID.make("test"))
          expect(configured.options.timeout).toBe(false)
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          const result = streamText({
            model: yield* provider.getLanguage(model),
            abortSignal: abort.signal,
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })

          const error = yield* Effect.promise(() => readStreamError(result, abort))
          expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { timeout: false, chunkTimeout: 50 }) },
    )
  }),
)

it.live("provider SDK preserves finite JSON response content and headers", () =>
  Effect.gen(function* () {
    const body = JSON.stringify({
      id: "chatcmpl-json",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "json" }, finish_reason: "stop" }],
    })
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          contentType: "application/json",
          status: 201,
          statusMessage: "Created By Test",
          headers: { "x-test-response": "preserved" },
          chunks: [{ delay: 0, body }],
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const language = yield* provider.getLanguage(model)

          const result = yield* Effect.promise(() =>
            language.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
          )
          expect(result.content).toEqual([{ type: "text", text: "json" }])
          expect(result.response?.headers?.["x-test-response"]).toBe("preserved")
          expect(result.response?.body).toEqual(JSON.parse(body))
        }),
      { config: providerConfig(server.url, { chunkTimeout: 50 }) },
    )
  }),
)

it.live("chunkTimeout applies while a non-streaming JSON body is read", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          contentType: "application/json",
          chunks: [{ delay: 0, body: '{"choices":[' }],
          end: false,
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const language = yield* provider.getLanguage(model)
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          const error = yield* Effect.promise(async () => {
            const timeout = setTimeout(() => abort.abort(new Error("bounded test timeout")), 2_000)
            try {
              return await language.doGenerate({
                abortSignal: abort.signal,
                prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
              })
            } catch (error) {
              return error
            } finally {
              clearTimeout(timeout)
            }
          })

          expect(APICallError.isInstance(error)).toBe(true)
          if (APICallError.isInstance(error)) {
            expect(error.cause).toBeInstanceOf(ProviderError.ResponseStreamError)
          }
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { chunkTimeout: 50 }) },
    )
  }),
)

it.live("caller abort closes a stalled response after progress", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          chunks: [{ delay: 0, body: event({ choices: [{ delta: { content: "partial" } }] }) }],
          end: false,
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          const result = streamText({
            model: yield* provider.getLanguage(model),
            abortSignal: abort.signal,
            onError() {},
            messages: [{ role: "user", content: "hello" }],
          })
          const consumed = (async () => {
            for await (const part of result.fullStream) {
              if (part.type !== "text-delta") continue
              abort.abort(new Error("caller cancelled"))
              return
            }
          })()

          expect(yield* Effect.promise(() => bounded(consumed, 2_000))).toBe(true)
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { chunkTimeout: 10_000 }) },
    )
  }),
)

it.live("consumer cancellation aborts the wrapped provider fetch", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        localBodyServer({
          chunks: [{ delay: 0, body: event({ choices: [{ delta: { content: "partial" } }] }) }],
          end: false,
        }),
      ),
      (server) => Effect.promise(() => closeServer(server.server)),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const configured = yield* provider.getProvider(ProviderV2.ID.make("test"))
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          let aborted = false
          configured.options.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            init?.signal?.addEventListener("abort", () => {
              aborted = true
            })
            return fetch(input, init)
          }
          const language = yield* provider.getLanguage(model)
          const result = yield* Effect.promise(() =>
            language.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
          )
          const consumed = (async () => {
            const reader = result.stream.getReader()
            while (true) {
              const part = await reader.read()
              if (part.done) return
              if (part.value.type !== "text-delta") continue
              await reader.cancel("consumer cancelled")
              return
            }
          })()

          expect(yield* Effect.promise(() => bounded(consumed, 2_000))).toBe(true)
          expect(aborted).toBe(true)
          expect(yield* Effect.promise(() => bounded(server.responseClosed, 2_000))).toBe(true)
        }),
      { config: providerConfig(server.url, { chunkTimeout: 10_000 }) },
    )
  }),
)

for (const timeout of ["chunkTimeout", "headerTimeout"] as const) {
  it.live(`default ${timeout} is applied at fetch without changing provider options`, () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.promise(() => delayedBodyServer(250)),
        (server) => Effect.sync(() => server.server.close()),
      )

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const configured = yield* provider.getProvider(ProviderV2.ID.make("test"))
            const signals: (AbortSignal | null | undefined)[] = []
            configured.options.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
              signals.push(init?.signal)
              return fetch(input, init)
            }
            const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
            const language = yield* provider.getLanguage(model)
            yield* Effect.acquireRelease(
              Effect.promise(() =>
                language.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
              ),
              (result) => Effect.promise(() => result.stream.cancel()),
            )

            expect(signals).toHaveLength(1)
            expect(signals[0]).toBeInstanceOf(AbortSignal)
            expect(configured.options[timeout]).toBeUndefined()
          }),
        {
          config: providerConfig(server.url, {
            [timeout === "chunkTimeout" ? "headerTimeout" : "chunkTimeout"]: false,
          }),
        },
      )
    }),
  )
}

it.live("configured chunkTimeout raises a retryable response stream error when SSE body stalls", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => delayedBodyServer(250)),
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
          expect(error).toBeInstanceOf(ProviderError.ResponseStreamError)
          expect(
            SessionRetry.retryable(MessageV2.fromError(error, { providerID: model.providerID }), model.providerID),
          ).toEqual({ message: "SSE read timed out" })
        }),
      { config: providerConfig(server.url, { chunkTimeout: 50 }) },
    )
  }),
)

for (const contentType of ["text/event-stream", undefined] as const) {
  it.live(`chunkTimeout can be disabled with false (${contentType ?? "absent content type"})`, () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          localBodyServer({
            contentType,
            chunks: [
              {
                delay: 250,
                body: `${event({ choices: [{ delta: { content: "late" } }] })}data: [DONE]\n\n`,
              },
            ],
          }),
        ),
        (server) => Effect.promise(() => closeServer(server.server)),
      )

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const configured = yield* provider.getProvider(ProviderV2.ID.make("test"))
            expect(configured.options.chunkTimeout).toBe(false)
            const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
            const result = streamText({
              model: yield* provider.getLanguage(model),
              messages: [{ role: "user", content: "hello" }],
            })

            expect(yield* Effect.promise(() => result.text)).toBe("late")
          }),
        { config: providerConfig(server.url, { chunkTimeout: false }) },
      )
    }),
  )
}

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
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
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

it.live("headerTimeout can be disabled with false for non-OpenAI providers", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => delayedHeaderServer(100)),
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

          expect(yield* Effect.promise(() => result.text)).toBe("ok")
        }),
      { config: providerConfig(server.url, { headerTimeout: false }) },
    )
  }),
)

it.live("OpenAI Codex header and chunk timeout defaults can be disabled by config", () =>
  Effect.gen(function* () {
    yield* withAuthContent(
      Effect.gen(function* () {
        yield* provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const provider = yield* Provider.Service
              const openai = yield* provider.getProvider(ProviderV2.ID.openai)
              expect(openai.options.headerTimeout).toBe(false)
              expect(openai.options.chunkTimeout).toBe(false)
            }),
          { config: { provider: { openai: { options: { headerTimeout: false, chunkTimeout: false } } } } },
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
            const openai = yield* provider.getProvider(ProviderV2.ID.openai)
            expect(openai.options.headerTimeout).toBe(300_000)
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

function bedrockProviderConfig(url: string, options: Record<string, unknown> = {}) {
  const config = testProviderConfig(url)
  return {
    ...config,
    provider: {
      test: {
        ...config.provider.test,
        npm: "@ai-sdk/amazon-bedrock",
        options: {
          ...config.provider.test.options,
          apiKey: "test-key",
          baseURL: url,
          region: "us-east-1",
          ...options,
        },
      },
    },
  }
}

type LocalBodyServer = {
  server: Server
  url: string
  responseClosed: Promise<void>
}

async function localBodyServer(input: {
  contentType?: string
  status?: number
  statusMessage?: string
  headers?: Record<string, string>
  chunks?: { delay: number; body: string | Uint8Array }[]
  end?: boolean
}): Promise<LocalBodyServer> {
  let resolveClosed!: () => void
  let closed = false
  const responseClosed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const server = createServer((req, res) => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const markClosed = () => {
      for (const timer of timers) clearTimeout(timer)
      if (closed) return
      closed = true
      resolveClosed()
    }
    req.once("aborted", markClosed)
    res.once("close", markClosed)
    res.once("finish", markClosed)

    const headers = { ...input.headers }
    if (input.contentType !== undefined) headers["content-type"] = input.contentType
    if (input.statusMessage !== undefined) res.statusMessage = input.statusMessage
    res.writeHead(input.status ?? 200, headers)
    res.flushHeaders()

    let delay = 0
    for (const chunk of input.chunks ?? []) {
      delay += chunk.delay
      timers.push(setTimeout(() => res.write(chunk.body), delay))
    }
    if (input.end !== false) timers.push(setTimeout(() => res.end(), delay))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port")
  return { server, url: `http://127.0.0.1:${address.port}`, responseClosed }
}

async function closeServer(server: Server) {
  if (!server.listening) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000)
    server.close(() => {
      clearTimeout(timeout)
      resolve()
    })
    server.closeIdleConnections()
    server.closeAllConnections()
  })
}

function event(input: unknown) {
  return `data: ${JSON.stringify(input)}\n\n`
}

function bedrockEvent(type: string, input: unknown) {
  const encoder = new TextEncoder()
  const headers = [
    eventStreamHeader(encoder, ":message-type", "event"),
    eventStreamHeader(encoder, ":event-type", type),
  ]
  const headerLength = headers.reduce((total, header) => total + header.length, 0)
  const body = encoder.encode(JSON.stringify(input))
  const totalLength = 16 + headerLength + body.length
  const frame = new Uint8Array(totalLength)
  const view = new DataView(frame.buffer)
  view.setUint32(0, totalLength)
  view.setUint32(4, headerLength)
  view.setUint32(8, crc32(frame.subarray(0, 8)))
  let offset = 12
  for (const header of headers) {
    frame.set(header, offset)
    offset += header.length
  }
  frame.set(body, offset)
  view.setUint32(totalLength - 4, crc32(frame.subarray(0, totalLength - 4)))
  return frame
}

function eventStreamHeader(encoder: TextEncoder, name: string, value: string) {
  const encodedName = encoder.encode(name)
  const encodedValue = encoder.encode(value)
  const header = new Uint8Array(1 + encodedName.length + 1 + 2 + encodedValue.length)
  header[0] = encodedName.length
  header.set(encodedName, 1)
  header[1 + encodedName.length] = 7
  new DataView(header.buffer).setUint16(2 + encodedName.length, encodedValue.length)
  header.set(encodedValue, 4 + encodedName.length)
  return header
}

function crc32(input: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function readStreamError(result: ReturnType<typeof streamText>, abort: AbortController) {
  const timeout = setTimeout(() => abort.abort(new Error("bounded test timeout")), 2_000)
  try {
    for await (const part of result.fullStream) {
      if (part.type === "error") return part.error
    }
    return new Error("stream completed without an error")
  } catch (error) {
    return error
  } finally {
    clearTimeout(timeout)
  }
}

function bounded<A>(input: Promise<A>, ms: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), ms)
    input.then(
      () => {
        clearTimeout(timeout)
        resolve(true)
      },
      () => {
        clearTimeout(timeout)
        resolve(false)
      },
    )
  })
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

async function delayedBodyServer(delay: number): Promise<{ server: Server; url: string }> {
  const server = createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.flushHeaders()
    setTimeout(() => {
      res.end('data: {"choices":[{"delta":{"content":"late"}}]}\n\ndata: [DONE]\n\n')
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
