import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { make } from "@opencode/core/plugin/provider/model-discovery"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { withEnv } from "../fixture/env"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)
const remote = {
  id: "gateway/gpt",
  context_window: 1_050_000,
  max_input_tokens: 1_050_000,
  max_output_tokens: 128_000,
  supported_endpoints: ["/v1/responses"],
  supports_function_calling: true,
  supports_parallel_function_calling: false,
  supports_reasoning: true,
  reasoning_effort_levels: ["low", "high", "xhigh", "max"],
  default_reasoning_effort: "high",
  supported_modalities: ["text", "image"],
  supported_output_modalities: ["text"],
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 2000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for gateway discovery"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("OpenAI-compatible model discovery", () => {
  it.live("authenticates the first cold-start discovery request using configured environment credentials", () =>
    withEnv({ OPENCODE_DISCOVERY_FIXTURE_KEY: "env-fixture-key" }, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const requests: (string | null)[] = []
          return {
            requests,
            server: Bun.serve({
              port: 0,
              fetch: (request) => {
                requests.push(request.headers.get("authorization"))
                return request.headers.get("authorization") === "Bearer env-fixture-key"
                  ? Response.json({ data: [remote] })
                  : new Response(null, { status: 401 })
              },
            }),
          }
        }),
        ({ requests, server }) =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            yield* config.setEntries([
              new Document({
                type: "document",
                info: decode({
                  providers: {
                    gateway: {
                      env: ["OPENCODE_DISCOVERY_UNSET", "OPENCODE_DISCOVERY_FIXTURE_KEY"],
                      settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: true },
                    },
                  },
                }),
              }),
            ])
            const host = yield* PluginHost.make(yield* Plugin.Service)
            yield* make("1 hour").effect(host)
            const models = yield* Model.Service
            expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toBeDefined()
            expect(requests).toEqual(["Bearer env-fixture-key"])
            yield* ConfigProviderPlugin.Plugin.effect(host)
          }),
        ({ server }) => Effect.promise(() => server.stop(true)),
      ),
    ),
  )
  it.live("treats successful inventories as authoritative and restores static models when disabled", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { models: [remote] }
        return { state, server: Bun.serve({ port: 0, fetch: () => Response.json({ data: state.models }) }) }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const entry = (enabled: boolean) =>
            new Document({
              type: "document",
              info: decode({
                providers: { gateway: { settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: enabled } } },
              }),
            })
          yield* config.setEntries([entry(true)])
          const providers = yield* Provider.Service
          yield* providers.transform((editor) => {
            editor.models.update(Provider.ID.make("gateway"), Model.ID.make("static-only"), (model) => {
              model.limit.context = 272_000
            })
          })
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* make("5 millis").effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const models = yield* Model.Service
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("static-only"))).toBeUndefined()
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toBeDefined()
          state.models = []
          yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (model) => model === undefined,
          )
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("static-only"))).toBeUndefined()
          yield* config.setEntries([entry(false)])
          const bus = yield* Bus.Service
          yield* bus.publish(Event.Updated, {})
          const restored = yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make("static-only")),
            (model) => model !== undefined,
          )
          expect(restored).toMatchObject({ limit: { context: 272_000 } })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
  it.live("discovers route metadata with one provider definition and no model configuration", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({
        requests: [] as Request[],
        server: Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) }),
      })),
      ({ server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                providers: {
                  gateway: {
                    settings: { baseURL: `${server.url.origin}/v1`, apiKey: "fixture-key", modelDiscovery: true },
                  },
                },
              }),
            }),
          ])
          yield* make("5 millis").effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const models = yield* Model.Service
          const selected = yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (item) => item !== undefined,
          )
          expect(selected).toMatchObject({
            id: remote.id,
            modelID: remote.id,
            package: "@opencode/ai/providers/openai/responses",
            limit: { context: 1_050_000, input: 1_050_000, output: 128_000 },
            capabilities: {
              tools: true,
              parallelTools: false,
              reasoning: true,
              endpoints: ["/v1/responses"],
              input: ["text", "image"],
              output: ["text"],
            },
            settings: { reasoningEffort: "high" },
          })
          expect(selected?.variants.map((variant) => String(variant.id))).toEqual(["low", "high", "xhigh", "max"])
          expect(selected).toBeDefined()
          if (!selected) return
          const resolved = yield* ModelResolver.fromCatalogModel({
            ...selected,
            settings: { ...selected.settings, baseURL: `${server.url.origin}/v1`, apiKey: "fixture-key" },
          })
          expect(resolved.route.endpoint.baseURL).toBe(`${server.url.origin}/v1`)
          expect(Provider.nativeSettings({ modelDiscovery: true, apiKey: "fixture-key" })).toEqual({
            apiKey: "fixture-key",
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("explicit local fields override discovery and static limits without affecting other fields", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) })),
      (server) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                providers: {
                  gateway: {
                    settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: true },
                    models: {
                      [remote.id]: {
                        package: "@opencode/ai/providers/openai-compatible",
                        limit: { input: 400_000 },
                        capabilities: { tools: false },
                        settings: { reasoningEffort: "low" },
                      },
                    },
                  },
                },
              }),
            }),
          ])
          const providers = yield* Provider.Service
          yield* providers.transform((editor) => {
            editor.models.update(Provider.ID.make("gateway"), Model.ID.make(remote.id), (model) => {
              model.limit = { context: 272_000, input: 272_000, output: 32_000 }
            })
          })
          yield* make("5 millis").effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const models = yield* Model.Service
          const selected = yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (item) => item?.limit.context === 1_050_000,
          )
          expect(selected).toMatchObject({
            package: "@opencode/ai/providers/openai-compatible",
            limit: { context: 1_050_000, input: 400_000, output: 128_000 },
            capabilities: { tools: false, reasoning: true },
            settings: { reasoningEffort: "low" },
          })
          expect(selected?.variants.map((variant) => String(variant.id))).toEqual(["low", "high", "xhigh", "max"])
          expect(selected?.variants.every((variant) => variant.settings?.include === undefined)).toBe(true)
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("preserves unknown limits, explicit false capabilities and empty reasoning levels", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              data: [
                { id: "unknown", max_input_tokens: 400_000, context_window: null, max_output_tokens: null },
                {
                  id: "chosen-budget",
                  context_window: 262144,
                  max_output_tokens: null,
                  supports_reasoning: true,
                  request_defaults: {
                    output_token_budget: 8192,
                    output_token_budget_by_reasoning_effort: { low: 65536, high: 65536, xhigh: 65536, max: 131072 },
                  },
                },
                {
                  ...remote,
                  id: "plain",
                  supported_endpoints: ["/chat/completions"],
                  supports_function_calling: false,
                  supports_parallel_function_calling: false,
                  supports_reasoning: false,
                  reasoning_effort_levels: [],
                  supported_modalities: ["text"],
                  supported_output_modalities: [],
                },
                { ...remote, id: "empty-efforts", reasoning_effort_levels: [], default_reasoning_effort: "invalid" },
                { ...remote, id: "unsupported", supported_endpoints: ["/audio/transcriptions"] },
              ],
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                providers: {
                  gateway: {
                    settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: true },
                  },
                },
              }),
            }),
          ])
          yield* make().effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const models = yield* Model.Service
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("unknown"))).toMatchObject({
            limit: { context: 0, input: 400_000, output: 0 },
          })
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("chosen-budget"))).toMatchObject({
            limit: { context: 262144, output: 0 },
            variants: [],
            requestDefaults: {
              outputTokenBudget: 8192,
              outputTokenBudgetByReasoningEffort: { low: 65536, high: 65536, xhigh: 65536, max: 131072 },
            },
          })
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("plain"))).toMatchObject({
            package: "@opencode/ai/providers/openai-compatible",
            variants: [],
            capabilities: { tools: false, reasoning: false, parallelTools: false, input: ["text"], output: [] },
          })
          const empty = yield* models.get(Provider.ID.make("gateway"), Model.ID.make("empty-efforts"))
          expect(empty?.variants).toEqual([])
          expect(empty?.settings?.reasoningEffort).toBeUndefined()
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("unsupported"))).toMatchObject({
            enabled: false,
          })
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("uses configured credentials and preserves legacy models through unauthorized or malformed responses", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = {
          mode: "unauthorized",
          requests: [] as { path: string; authorization: string | null; custom: string | null }[],
        }
        return {
          state,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              state.requests.push({
                path: new URL(request.url).pathname,
                authorization: request.headers.get("authorization"),
                custom: request.headers.get("x-fixture"),
              })
              if (state.mode === "unauthorized") return new Response(null, { status: 401 })
              if (state.mode === "malformed")
                return Response.json({ data: [{ ...remote, context_window: "not-a-limit" }] })
              return Response.json({ data: [remote] })
            },
          }),
        }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                providers: {
                  gateway: {
                    settings: {
                      baseURL: `${server.url.origin}/prefix/v1`,
                      apiKey: "fixture-key",
                      modelDiscovery: true,
                    },
                    headers: { "x-fixture": "present" },
                    models: { legacy: { limit: { context: 272_000, output: 32_000 } } },
                  },
                },
              }),
            }),
          ])
          yield* make("5 millis").effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const models = yield* Model.Service
          yield* Effect.promise(() => Bun.sleep(30))
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("legacy"))).toMatchObject({
            limit: { context: 272_000, output: 32_000 },
          })
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toBeUndefined()
          state.mode = "malformed"
          yield* Effect.promise(() => Bun.sleep(30))
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toBeUndefined()
          state.mode = "valid"
          yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (item) => item !== undefined,
          )
          state.mode = "malformed"
          yield* Effect.promise(() => Bun.sleep(30))
          expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toMatchObject({
            limit: { context: 1_050_000 },
          })
          expect(state.requests).toContainEqual({
            path: "/prefix/v1/models",
            authorization: "Bearer fixture-key",
            custom: "present",
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
