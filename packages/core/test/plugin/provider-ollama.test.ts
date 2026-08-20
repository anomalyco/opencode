import { Bus } from "@opencode-ai/core/bus"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OllamaPlugin, make } from "@opencode-ai/core/plugin/provider/ollama"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { Provider } from "@opencode-ai/core/provider"
import { Document, Event, Info } from "@opencode-ai/schema/config"
import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)
const decodeShowRequest = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }))

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

describe("OllamaPlugin", () => {
  it.live("discovers local completion models and native metadata", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{ method: string; path: string; model?: string }> = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: async (request) => {
              const path = new URL(request.url).pathname
              if (request.method === "GET") {
                requests.push({ method: request.method, path })
                return Response.json({
                  models: [
                    summary("gemma3:4b", "gemma-digest", "gemma3"),
                    summary("nomic-embed", "embed-digest"),
                    summary("removed-model", "removed-digest"),
                  ],
                })
              }
              const body = decodeShowRequest(await request.json())
              requests.push({ method: request.method, path, model: body.model })
              if (body.model === "removed-model") return new Response("Not found", { status: 404 })
              return Response.json(
                body.model === "gemma3:4b"
                  ? {
                      capabilities: ["completion", "tools", "vision"],
                      model_info: { "gemma3.context_length": 131_072 },
                    }
                  : show({ family: "nomic-bert", capabilities: ["embedding"], context: 8192 }),
              )
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const providerID = Provider.ID.make("ollama")
          expect(OllamaPlugin.id).toBe("opencode.provider.ollama")
          expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.ollama")
          yield* addPlugin(server.url.origin)
          const model = yield* eventually(
            catalog.model.get(providerID, Model.ID.make("gemma3:4b")),
            (item) => item !== undefined,
          )

          expect(yield* catalog.provider.get(providerID)).toEqual({
            id: providerID,
            name: "Ollama",
            activation: "enabled",
            package: "@opencode-ai/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, provider: "ollama", apiKey: "" },
          })
          expect(model).toMatchObject({
            modelID: "gemma3:4b",
            name: "gemma3:4b",
            family: "gemma3",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            limit: { context: 131_072, output: 0 },
          })
          expect(yield* catalog.model.get(providerID, Model.ID.make("nomic-embed"))).toBeUndefined()
          expect(requests).toContainEqual({ method: "GET", path: "/api/tags" })
          expect(requests).toContainEqual({ method: "POST", path: "/api/show", model: "gemma3:4b" })
          expect(requests).toContainEqual({ method: "POST", path: "/api/show", model: "nomic-embed" })
          expect(requests).toContainEqual({ method: "POST", path: "/api/show", model: "removed-model" })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refreshes changed digests and retains inventory through transient failures", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { digest: "digest-1", context: 32_768, fail: false }
        const requests = { tags: 0, show: 0 }
        return {
          state,
          requests,
          server: Bun.serve({
            port: 0,
            fetch: async (request) => {
              if (request.method === "GET") {
                requests.tags++
                if (state.fail) return new Response("unavailable", { status: 503 })
                return Response.json({ models: [summary("qwen3:8b", state.digest, "qwen3")] })
              }
              decodeShowRequest(await request.json())
              requests.show++
              return Response.json(
                show({ family: "qwen3", capabilities: ["completion", "tools"], context: state.context }),
              )
            },
          }),
        }
      }),
      ({ state, requests, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const providerID = Provider.ID.make("ollama")
          const modelID = Model.ID.make("qwen3:8b")
          yield* addPlugin(server.url.origin, "5 millis")
          yield* eventually(catalog.model.get(providerID, modelID), (model) => model?.limit.context === 32_768)
          yield* eventually(
            Effect.sync(() => requests.tags),
            (count) => count >= 2,
          )
          expect(requests.show).toBe(1)

          state.digest = "digest-2"
          state.context = 65_536
          yield* eventually(catalog.model.get(providerID, modelID), (model) => model?.limit.context === 65_536)
          expect(requests.show).toBe(2)

          state.fail = true
          yield* Effect.promise(() => Bun.sleep(30))
          expect((yield* catalog.model.get(providerID, modelID))?.limit.context).toBe(65_536)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("replaces and restores the same-ID Models.dev provider", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const models = [summary("discovered-model", "digest")]
        return {
          models,
          server: Bun.serve({
            port: 0,
            fetch: async (request) => {
              if (request.method === "GET") return Response.json({ models })
              decodeShowRequest(await request.json())
              return Response.json(show({ capabilities: ["completion"], context: 32_768 }))
            },
          }),
        }
      }),
      ({ models, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          const providerID = Provider.ID.make("ollama")
          yield* integrations.transform((draft) => {
            draft.update(Integration.ID.make("ollama"), (integration) => {
              integration.name = "Ollama"
            })
            draft.method.update({
              integrationID: Integration.ID.make("ollama"),
              method: { type: "env", names: ["OLLAMA_API_KEY"] },
            })
          })
          yield* catalog.transform((draft) => {
            draft.provider.update(providerID, (provider) => {
              provider.name = "Ollama"
              provider.package = "aisdk:@ai-sdk/openai-compatible"
              provider.integrationID = Integration.ID.make("ollama")
            })
            draft.model.update(providerID, Model.ID.make("static-model"), () => {})
          })

          yield* addPlugin(server.url.origin, "5 millis")
          yield* eventually(
            catalog.model.get(providerID, Model.ID.make("discovered-model")),
            (model) => model !== undefined,
          )
          expect(yield* integrations.get(Integration.ID.make("ollama"))).toBeUndefined()
          expect((yield* catalog.provider.get(providerID))?.activation).toBe("enabled")
          expect(yield* catalog.model.get(providerID, Model.ID.make("static-model"))).toBeUndefined()

          models.splice(0)
          yield* eventually(
            catalog.model.get(providerID, Model.ID.make("static-model")),
            (model) => model !== undefined,
          )
          expect(yield* catalog.model.get(providerID, Model.ID.make("discovered-model"))).toBeUndefined()
          expect(yield* integrations.get(Integration.ID.make("ollama"))).toBeDefined()
          expect((yield* catalog.provider.get(providerID))?.activation).toBe("auto")
          expect((yield* catalog.provider.get(providerID))?.integrationID).toBe(Integration.ID.make("ollama"))
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live(
    "reloads layered endpoint and bearer authentication settings",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const requests: Array<{ authorization: string | null; method: string; path: string }> = []
          return {
            requests,
            initial: Bun.serve({
              port: 0,
              fetch: async (request) => {
                if (request.method === "GET")
                  return Response.json({ models: [summary("initial-model", "initial-digest")] })
                decodeShowRequest(await request.json())
                return Response.json(show({ capabilities: ["completion"], context: 4096 }))
              },
            }),
            configured: Bun.serve({
              port: 0,
              fetch: async (request) => {
                requests.push({
                  authorization: request.headers.get("authorization"),
                  method: request.method,
                  path: new URL(request.url).pathname,
                })
                if (request.method === "GET")
                  return Response.json({ models: [summary("configured-model", "configured-digest")] })
                decodeShowRequest(await request.json())
                return Response.json(show({ capabilities: ["completion", "vision"], context: 65_536 }))
              },
            }),
          }
        }),
        ({ requests, initial, configured }) =>
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const catalog = yield* Catalog.Service
            const config = yield* Config.Test
            const providerID = Provider.ID.make("ollama")
            yield* addPlugin(initial.url.origin)
            yield* eventually(
              catalog.model.get(providerID, Model.ID.make("initial-model")),
              (model) => model !== undefined,
            )

            const baseURL = `${configured.url.origin}/proxy/v1`
            yield* config.setEntries([configuration({ baseURL, apiKey: "old" }), configuration({ apiKey: "secret" })])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              catalog.model.get(providerID, Model.ID.make("configured-model")),
              (model) => model !== undefined,
            )
            expect(requests).toContainEqual({ authorization: "Bearer secret", method: "GET", path: "/proxy/api/tags" })
            expect(requests).toContainEqual({ authorization: "Bearer secret", method: "POST", path: "/proxy/api/show" })
            expect(yield* catalog.model.get(providerID, Model.ID.make("initial-model"))).toBeUndefined()
            expect((yield* catalog.provider.get(providerID))?.settings).toEqual({
              baseURL,
              provider: "ollama",
              apiKey: "secret",
            })

            requests.splice(0)
            yield* config.setEntries([configuration({ baseURL, apiKey: "secret" }), configuration({ apiKey: null })])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(catalog.provider.get(providerID), (provider) => provider?.settings?.apiKey === "")
            expect(requests).toContainEqual({ authorization: null, method: "GET", path: "/proxy/api/tags" })
            expect(requests).toContainEqual({ authorization: null, method: "POST", path: "/proxy/api/show" })
          }),
        ({ initial, configured }) => Effect.promise(() => Promise.all([initial.stop(true), configured.stop(true)])),
      ),
    10_000,
  )
})

function summary(model: string, digest: string, family = "llama") {
  return {
    name: model,
    model,
    modified_at: "2026-01-01T00:00:00Z",
    size: 1_000_000,
    digest,
    details: {
      format: "gguf",
      family,
      families: [family],
      parameter_size: "8B",
      quantization_level: "Q4_K_M",
    },
  }
}

function show(input: { family?: string; capabilities: string[]; context: number }) {
  const family = input.family ?? "llama"
  return {
    parameters: "temperature 0.7",
    details: {
      parent_model: "",
      format: "gguf",
      family,
      families: [family],
      parameter_size: "8B",
      quantization_level: "Q4_K_M",
    },
    capabilities: input.capabilities,
    model_info: {
      "general.architecture": family,
      [`${family}.context_length`]: input.context,
    },
  }
}

function configuration(settings: Record<string, string | null>) {
  return new Document({
    type: "document",
    info: decode({ providers: { ollama: { settings } } }),
  })
}
