import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { LiteLLMPlugin, make } from "@opencode/core/plugin/provider/litellm"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)

const addPlugin = Effect.fn(function* (origin: string, interval: Duration.Input = "1 hour") {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* make(origin, interval).effect(host)
})

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 3000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

const remoteModel = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  object: "model",
  created: 1677610602,
  owned_by: "openai",
  ...extra,
})

// Answers the LiteLLM liveliness check, under any path prefix, and passes other requests to the handler.
const proxy = (handler: (request: Request) => Response) => (request: Request) =>
  new URL(request.url).pathname.endsWith("/health/liveliness") ? Response.json("I'm alive!") : handler(request)

describe("LiteLLMPlugin", () => {
  it.live("discovers chat models from an unauthenticated proxy", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{ authorization: string | null; path: string }> = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              requests.push({
                authorization: request.headers.get("authorization"),
                path: new URL(request.url).pathname,
              })
              return proxy(() =>
                Response.json({
                  object: "list",
                  data: [
                    remoteModel("gpt-6-luna", { mode: "chat", max_input_tokens: 200_000, max_output_tokens: 64_000 }),
                    remoteModel("old-proxy-alias"),
                    remoteModel("null-metadata", { mode: null, max_input_tokens: null }),
                    remoteModel("text-embedding-3-large", { mode: "embedding", max_input_tokens: 8191 }),
                    remoteModel("image-model", { mode: "image_generation" }),
                    remoteModel(""),
                  ],
                }),
              )(request)
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const providers = yield* Provider.Service
          const modelState = yield* Model.Service
          const providerID = Provider.ID.make("litellm")
          expect(LiteLLMPlugin.id).toBe("opencode.provider.litellm")
          expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.litellm")
          yield* addPlugin(server.url.origin, "5 millis")
          const model = yield* eventually(
            modelState.get(providerID, Model.ID.make("gpt-6-luna")),
            (item) => item !== undefined,
          )
          expect(yield* providers.get(providerID)).toEqual({
            id: providerID,
            name: "LiteLLM",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, provider: "litellm", apiKey: "" },
            activation: "enabled",
          })
          expect((yield* providers.available()).map((provider) => provider.id)).toContain(providerID)
          expect(model).toMatchObject({
            modelID: "gpt-6-luna",
            name: "gpt-6-luna",
            capabilities: { tools: false, input: ["text"], output: ["text"] },
            limit: { context: 200_000, output: 32_000 },
          })
          expect(yield* modelState.get(providerID, Model.ID.make("old-proxy-alias"))).toMatchObject({
            limit: { context: 200_000, output: 32_000 },
          })
          expect(yield* modelState.get(providerID, Model.ID.make("null-metadata"))).toBeDefined()
          expect(yield* modelState.get(providerID, Model.ID.make("text-embedding-3-large"))).toBeUndefined()
          expect(yield* modelState.get(providerID, Model.ID.make("image-model"))).toBeUndefined()
          expect(requests).toContainEqual({ authorization: null, path: "/health/liveliness" })
          expect(requests).toContainEqual({ authorization: null, path: "/v1/models" })
          expect(requests.every((request) => request.authorization === null)).toBe(true)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("keeps the last inventory through a transient failure", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { failing: false, models: [remoteModel("first-model")] }
        return {
          state,
          server: Bun.serve({
            port: 0,
            fetch: proxy(() =>
              state.failing
                ? new Response(null, { status: 502 })
                : Response.json({ object: "list", data: state.models }),
            ),
          }),
        }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const modelState = yield* Model.Service
          const providerID = Provider.ID.make("litellm")
          yield* addPlugin(server.url.origin, "5 millis")
          yield* eventually(modelState.get(providerID, Model.ID.make("first-model")), (model) => model !== undefined)

          state.failing = true
          state.models = [remoteModel("second-model")]
          yield* Effect.promise(() => Bun.sleep(30))
          expect(yield* modelState.get(providerID, Model.ID.make("first-model"))).toBeDefined()
          expect(yield* modelState.get(providerID, Model.ID.make("second-model"))).toBeUndefined()

          state.failing = false
          yield* eventually(modelState.get(providerID, Model.ID.make("second-model")), (model) => model !== undefined)
          expect(yield* modelState.get(providerID, Model.ID.make("first-model"))).toBeUndefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("ignores an OpenAI-compatible server that is not LiteLLM", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: string[] = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            // A dev server that gives 200 for every path, and another OpenAI-compatible server.
            fetch: (request) => {
              const path = new URL(request.url).pathname
              requests.push(path)
              return path === "/v1/models"
                ? Response.json({ object: "list", data: [remoteModel("other-model")] })
                : new Response("<html></html>", { headers: { "content-type": "text/html" } })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const providers = yield* Provider.Service
          const modelState = yield* Model.Service
          const providerID = Provider.ID.make("litellm")
          yield* addPlugin(server.url.origin, "5 millis")
          yield* eventually(
            Effect.sync(() => requests.length),
            (count) => count >= 3,
          )
          expect(requests).not.toContain("/v1/models")
          expect(yield* modelState.get(providerID, Model.ID.make("other-model"))).toBeUndefined()
          expect((yield* providers.available()).map((provider) => provider.id)).not.toContain(providerID)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live(
    "reloads a configured endpoint and sends the key as a bearer token",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const requests: Array<{ authorization: string | null; path: string }> = []
          return {
            requests,
            initial: Bun.serve({
              port: 0,
              fetch: proxy(() => Response.json({ object: "list", data: [remoteModel("initial-model")] })),
            }),
            configured: Bun.serve({
              port: 0,
              fetch: (request) => {
                requests.push({
                  authorization: request.headers.get("authorization"),
                  path: new URL(request.url).pathname,
                })
                return proxy(() => Response.json({ object: "list", data: [remoteModel("configured-model")] }))(request)
              },
            }),
          }
        }),
        ({ requests, initial, configured }) =>
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const providers = yield* Provider.Service
            const modelState = yield* Model.Service
            const config = yield* Config.Test
            const providerID = Provider.ID.make("litellm")
            yield* addPlugin(initial.url.origin)
            yield* eventually(
              modelState.get(providerID, Model.ID.make("initial-model")),
              (model) => model !== undefined,
            )

            const baseURL = `${configured.url.origin}/litellm/v1`
            yield* config.setEntries([configuration({ baseURL }), configuration({ apiKey: "sk-secret" })])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              modelState.get(providerID, Model.ID.make("configured-model")),
              (model) => model !== undefined,
            )

            expect(requests).toContainEqual({ authorization: "Bearer sk-secret", path: "/litellm/health/liveliness" })
            expect(requests).toContainEqual({ authorization: "Bearer sk-secret", path: "/litellm/v1/models" })
            expect(yield* modelState.get(providerID, Model.ID.make("initial-model"))).toBeUndefined()
            expect((yield* providers.get(providerID))?.settings).toEqual({
              baseURL,
              provider: "litellm",
              apiKey: "sk-secret",
            })
          }),
        ({ initial, configured }) => Effect.promise(() => Promise.all([initial.stop(true), configured.stop(true)])),
      ),
    10_000,
  )
})

function configuration(settings: { baseURL?: string; apiKey?: string }) {
  return new Document({
    type: "document",
    info: decode({ providers: { litellm: { settings } } }),
  })
}
