import { Bus } from "@opencode-ai/core/bus"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { make, VLLMPlugin } from "@opencode-ai/core/plugin/provider/vllm"
import { Provider } from "@opencode-ai/core/provider"
import { Document, Event, Info } from "@opencode-ai/schema/config"
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

const remoteModel = (id: string, max_model_len = 32_768, owned_by = "vllm") => ({
  id,
  object: "model",
  created: 1,
  owned_by,
  root: id,
  parent: null,
  max_model_len,
  permission: [],
})

describe("VLLMPlugin", () => {
  it.live("waits for readiness and discovers official vLLM model metadata", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { healthy: false, models: 0 }
        return {
          state,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              const path = new URL(request.url).pathname
              if (path === "/health") return new Response(null, { status: state.healthy ? 200 : 503 })
              state.models++
              return Response.json({
                object: "list",
                data: [
                  remoteModel("Qwen/Qwen3-Coder", 65_536),
                  remoteModel("unknown-limit", 0),
                  remoteModel("foreign-model", 4096, "other"),
                ],
              })
            },
          }),
        }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const providerID = Provider.ID.make("vllm")
          expect(VLLMPlugin.id).toBe("opencode.provider.vllm")
          expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.vllm")
          yield* addPlugin(server.url.origin, "5 millis")
          yield* Effect.promise(() => Bun.sleep(20))
          expect(yield* catalog.provider.get(providerID)).toBeUndefined()
          expect(state.models).toBe(0)

          state.healthy = true
          const model = yield* eventually(
            catalog.model.get(providerID, Model.ID.make("Qwen/Qwen3-Coder")),
            (item) => item !== undefined,
          )
          expect(yield* catalog.provider.get(providerID)).toEqual({
            id: providerID,
            name: "vLLM",
            package: "@opencode-ai/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, provider: "vllm", apiKey: "" },
            activation: "enabled",
          })
          expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(providerID)
          expect(model).toMatchObject({
            modelID: "Qwen/Qwen3-Coder",
            name: "Qwen/Qwen3-Coder",
            capabilities: { tools: false, input: ["text"], output: ["text"] },
            limit: { context: 65_536, output: 32_000 },
          })
          expect(yield* catalog.model.get(providerID, Model.ID.make("unknown-limit"))).toMatchObject({
            limit: { context: 200_000, output: 32_000 },
          })
          expect(yield* catalog.model.get(providerID, Model.ID.make("foreign-model"))).toBeUndefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refreshes inventory while retaining the last success through transient failures", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { failing: false, models: [remoteModel("first-model")] }
        return {
          state,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              if (state.failing) return new Response(null, { status: 503 })
              if (new URL(request.url).pathname === "/health") return new Response()
              return Response.json({ object: "list", data: state.models })
            },
          }),
        }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const providerID = Provider.ID.make("vllm")
          yield* addPlugin(server.url.origin, "5 millis")
          yield* eventually(catalog.model.get(providerID, Model.ID.make("first-model")), (model) => model !== undefined)

          state.failing = true
          state.models = [remoteModel("second-model")]
          yield* Effect.promise(() => Bun.sleep(30))
          expect(yield* catalog.model.get(providerID, Model.ID.make("first-model"))).toBeDefined()
          expect(yield* catalog.model.get(providerID, Model.ID.make("second-model"))).toBeUndefined()

          state.failing = false
          yield* eventually(
            catalog.model.get(providerID, Model.ID.make("second-model")),
            (model) => model !== undefined,
          )
          expect(yield* catalog.model.get(providerID, Model.ID.make("first-model"))).toBeUndefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("replaces and restores same-ID Models.dev entries after an empty success", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const models = [remoteModel("discovered-model")]
        return {
          models,
          server: Bun.serve({
            port: 0,
            fetch: (request) =>
              new URL(request.url).pathname === "/health"
                ? new Response()
                : Response.json({ object: "list", data: models }),
          }),
        }
      }),
      ({ models, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          const providerID = Provider.ID.make("vllm")
          yield* integrations.transform((editor) => {
            editor.update(Integration.ID.make("vllm"), (integration) => {
              integration.name = "vLLM"
            })
            editor.method.update({
              integrationID: Integration.ID.make("vllm"),
              method: { type: "env", names: ["VLLM_API_KEY"] },
            })
          })
          yield* catalog.transform((editor) => {
            editor.provider.update(providerID, (provider) => {
              provider.name = "vLLM"
              provider.package = "aisdk:@ai-sdk/openai-compatible"
              provider.integrationID = Integration.ID.make("vllm")
              provider.activation = "auto"
            })
            editor.model.update(providerID, Model.ID.make("static-model"), () => {})
          })

          yield* addPlugin(server.url.origin, "5 millis")
          yield* eventually(
            catalog.model.get(providerID, Model.ID.make("discovered-model")),
            (model) => model !== undefined,
          )
          expect(yield* integrations.get(Integration.ID.make("vllm"))).toBeUndefined()
          expect((yield* catalog.provider.get(providerID))?.integrationID).toBeUndefined()
          expect((yield* catalog.provider.get(providerID))?.activation).toBe("enabled")
          expect(yield* catalog.model.get(providerID, Model.ID.make("static-model"))).toBeUndefined()

          models.splice(0)
          yield* eventually(
            catalog.model.get(providerID, Model.ID.make("static-model")),
            (model) => model !== undefined,
          )
          expect(yield* catalog.model.get(providerID, Model.ID.make("discovered-model"))).toBeUndefined()
          expect(yield* integrations.get(Integration.ID.make("vllm"))).toBeDefined()
          expect((yield* catalog.provider.get(providerID))?.integrationID).toBe(Integration.ID.make("vllm"))
          expect((yield* catalog.provider.get(providerID))?.activation).toBe("auto")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live(
    "reloads layered custom endpoint and bearer authentication settings",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const requests: Array<{ authorization: string | null; path: string }> = []
          return {
            requests,
            initial: Bun.serve({
              port: 0,
              fetch: (request) =>
                new URL(request.url).pathname === "/health"
                  ? new Response()
                  : Response.json({ object: "list", data: [remoteModel("initial-model")] }),
            }),
            configured: Bun.serve({
              port: 0,
              fetch: (request) => {
                requests.push({
                  authorization: request.headers.get("authorization"),
                  path: new URL(request.url).pathname,
                })
                if (new URL(request.url).pathname === "/proxy/health") return new Response()
                return Response.json({ object: "list", data: [remoteModel("configured-model")] })
              },
            }),
          }
        }),
        ({ requests, initial, configured }) =>
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const catalog = yield* Catalog.Service
            const config = yield* Config.Test
            const providerID = Provider.ID.make("vllm")
            yield* addPlugin(initial.url.origin)
            yield* eventually(
              catalog.model.get(providerID, Model.ID.make("initial-model")),
              (model) => model !== undefined,
            )

            const baseURL = `${configured.url.origin}/proxy/v1`
            yield* config.setEntries([configuration({ baseURL }), configuration({ apiKey: "secret" })])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              catalog.model.get(providerID, Model.ID.make("configured-model")),
              (model) => model !== undefined,
            )

            expect(requests).toContainEqual({ authorization: "Bearer secret", path: "/proxy/health" })
            expect(requests).toContainEqual({ authorization: "Bearer secret", path: "/proxy/v1/models" })
            expect(yield* catalog.model.get(providerID, Model.ID.make("initial-model"))).toBeUndefined()
            expect((yield* catalog.provider.get(providerID))?.settings).toEqual({
              baseURL,
              provider: "vllm",
              apiKey: "secret",
            })

            requests.splice(0)
            yield* config.setEntries([configuration({ baseURL }), configuration({ apiKey: "next-secret" })])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              catalog.provider.get(providerID),
              (provider) => provider?.settings?.apiKey === "next-secret",
            )
            expect(requests).toContainEqual({ authorization: "Bearer next-secret", path: "/proxy/health" })
            expect(requests).toContainEqual({ authorization: "Bearer next-secret", path: "/proxy/v1/models" })
          }),
        ({ initial, configured }) => Effect.promise(() => Promise.all([initial.stop(true), configured.stop(true)])),
      ),
    10_000,
  )
})

function configuration(settings: { baseURL?: string; apiKey?: string }) {
  return new Document({
    type: "document",
    info: decode({ providers: { vllm: { settings } } }),
  })
}
