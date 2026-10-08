import { Credential } from "@opencode/core/credential"
import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { make } from "@opencode/core/plugin/provider/model-discovery"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { withEnv } from "../fixture/env"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)
const remote = {
  id: "orchid/large",
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
  it.live("removes selected gateway models after local overrides and restores them for parents and children", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { models: [remote], mode: "valid", requests: 0 }
        return {
          state,
          server: Bun.serve({
            port: 0,
            fetch: () => {
              state.requests++
              if (state.mode === "unauthorized") return new Response(null, { status: 401 })
              if (state.mode === "malformed") return Response.json({ data: [{ id: remote.id, context_window: "bad" }] })
              return Response.json({ data: state.models })
            },
          }),
        }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const entry = (key: string) =>
            new Document({
              type: "document",
              info: decode({
                providers: {
                  gateway: {
                    settings: { baseURL: `${server.url.origin}/v1`, apiKey: key, modelDiscovery: true },
                    models: { [remote.id]: { disabled: false, limit: { context: 900_000 } } },
                  },
                  "ordinary-free": {
                    package: "@opencode/ai/providers/openai-compatible",
                    models: { "willow/small": { limit: { context: 64_000, output: 8192 } } },
                  },
                },
              }),
            })
          yield* config.setEntries([entry("first-key")])
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* make("5 millis").effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const models = yield* Model.Service
          const runner = yield* SessionRunnerModel.Service
          const sessions = yield* Session.Service
          const location = yield* Location.Service
          const parent = yield* sessions.create({ location: { directory: location.directory } })
          const child = yield* sessions.create({ parentID: parent.id })
          const selected = (session: typeof parent) => ({
            ...session,
            model: Model.Ref.make({ providerID: Provider.ID.make("gateway"), id: Model.ID.make(remote.id) }),
          })
          for (const session of [parent, child])
            expect((yield* runner.resolve(selected(session), models.available)).limit.context).toBe(900_000)
          for (const mode of ["unauthorized", "malformed"]) {
            const before = state.requests
            state.mode = mode
            yield* eventually(
              Effect.sync(() => state.requests),
              (requests) => requests > before,
            )
            expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toBeDefined()
          }
          state.mode = "valid"
          state.models = []
          yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (model) => model === undefined,
          )
          for (const session of [parent, child]) {
            const result = yield* runner.resolve(selected(session), models.available).pipe(Effect.result)
            expect(result).toMatchObject({
              _tag: "Failure",
              failure: { _tag: "SessionRunnerModel.ModelUnavailableError" },
            })
          }
          expect(yield* models.get(Provider.ID.make("ordinary-free"), Model.ID.make("willow/small"))).toBeDefined()
          state.models = [{ ...remote, max_output_tokens: 64_000 }]
          yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (model) => model !== undefined,
          )
          for (const session of [parent, child]) {
            const refreshed = yield* runner.resolve(selected(session), models.available)
            expect(refreshed.limit).toMatchObject({ context: 900_000, output: 64_000 })
          }
          // A newly rejected account may use its own legacy config, but cannot inherit the old catalog metadata.
          state.mode = "unauthorized"
          yield* config.setEntries([entry("second-key")])
          const bus = yield* Bus.Service
          yield* bus.publish(Event.Updated, {})
          yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id)),
            (model) => model?.limit.output === 32_000,
          )
          expect(yield* models.get(Provider.ID.make("ordinary-free"), Model.ID.make("willow/small"))).toBeDefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
  it.live("discards a delayed old-account response after an overlapping credential refresh with unchanged config", () =>
    withEnv({ OPENCODE_DISCOVERY_REFRESH_KEY: "old-key" }, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const state = { hold: false, releases: [] as (() => void)[], newRequests: 0 }
          return {
            state,
            server: Bun.serve({
              port: 0,
              fetch: (request) => {
                if (request.headers.get("authorization") === "Bearer new-key") {
                  state.newRequests++
                  return Response.json({ data: [{ ...remote, id: "orchid/new-account" }] })
                }
                if (!state.hold) return Response.json({ data: [remote] })
                return new Promise<Response>((resolve) => {
                  state.releases.push(() => resolve(Response.json({ data: [remote] })))
                })
              },
            }),
          }
        }),
        ({ state, server }) =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            yield* config.setEntries([
              new Document({
                type: "document",
                info: decode({
                  providers: {
                    gateway: {
                      env: ["OPENCODE_DISCOVERY_REFRESH_KEY"],
                      settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: true },
                    },
                  },
                }),
              }),
            ])
            const host = yield* PluginHost.make(yield* Plugin.Service)
            yield* make("5 millis").effect(host)
            yield* ConfigProviderPlugin.Plugin.effect(host)
            const models = yield* Model.Service
            state.hold = true
            yield* eventually(
              Effect.sync(() => state.releases.length),
              (count) => count > 0,
            )
            process.env.OPENCODE_DISCOVERY_REFRESH_KEY = "new-key"
            const bus = yield* Bus.Service
            yield* bus.publish(Integration.Event.Updated, {})
            yield* eventually(
              models.get(Provider.ID.make("gateway"), Model.ID.make("orchid/new-account")),
              (model) => model !== undefined,
            )
            state.releases.forEach((release) => release())
            const before = state.newRequests
            yield* eventually(
              Effect.sync(() => state.newRequests),
              (count) => count > before,
            )
            expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toBeUndefined()
            expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make("orchid/new-account"))).toBeDefined()
          }),
        ({ state, server }) =>
          Effect.promise(() => {
            state.releases.forEach((release) => release())
            return server.stop(true)
          }),
      ),
    ),
  )
  it.live("bootstraps the first model read immediately after saving a key", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { authenticated: 0 }
        return {
          state,
          server: Bun.serve({
            port: 0,
            fetch: async (request) => {
              if (request.headers.get("authorization") !== "Bearer saved-fixture-key")
                return new Response(null, { status: 401 })
              state.authenticated++
              await Bun.sleep(30)
              return Response.json({ data: [remote] })
            },
          }),
        }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                providers: {
                  gateway: { settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: true } },
                },
              }),
            }),
          ])
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* make("1 hour").effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const integrations = yield* Integration.Service
          yield* integrations.connection.key({
            integrationID: Integration.ID.make("gateway"),
            key: "saved-fixture-key",
          })
          const models = yield* Model.Service
          const reads = yield* Effect.all([models.available(), models.available()], { concurrency: "unbounded" })
          for (const value of reads)
            expect(value.find((model) => model.providerID === "gateway" && model.id === remote.id)?.limit.context).toBe(
              remote.context_window,
            )
          expect(state.authenticated).toBe(1)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
  for (const mode of ["saved", "timeout"] as const) {
    it.live(
      `bootstraps saved credentials and bounds failed discovery: ${mode}`,
      () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            const state = { requests: 0 }
            return {
              state,
              server: Bun.serve({
                port: 0,
                fetch: async (request) => {
                  state.requests++
                  if (mode === "timeout") await new Promise<void>(() => {})
                  return request.headers.get("authorization") === "Bearer saved-fixture-key"
                    ? Response.json({ data: [remote] })
                    : new Response(null, { status: 401 })
                },
              }),
            }
          }),
          ({ state, server }) =>
            Effect.gen(function* () {
              const credentials = yield* Credential.Service
              yield* credentials.create({
                integrationID: Integration.ID.make("gateway"),
                value: Credential.Key.make({ type: "key", key: "saved-fixture-key" }),
              })
              const config = yield* Config.Test
              yield* config.setEntries([
                new Document({
                  type: "document",
                  info: decode({
                    providers: {
                      gateway: { settings: { baseURL: `${server.url.origin}/v1`, modelDiscovery: true } },
                      ordinary: { settings: { apiKey: "ordinary-fixture-key" }, models: { legacy: {} } },
                    },
                  }),
                }),
              ])
              const started = Date.now()
              const host = yield* PluginHost.make(yield* Plugin.Service)
              yield* make("1 hour").effect(host)
              yield* ConfigProviderPlugin.Plugin.effect(host)
              const models = yield* Model.Service
              const first = yield* models.available()
              const second = yield* models.available()
              expect(first).toEqual(second)
              expect(first.find((model) => model.providerID === "ordinary" && model.id === "legacy")).toBeDefined()
              expect(first.some((model) => model.providerID === "gateway" && model.id === remote.id)).toBe(
                mode === "saved",
              )
              expect(state.requests).toBe(1)
              expect((yield* credentials.list(Integration.ID.make("gateway"))).length).toBe(1)
              expect(Date.now() - started).toBeLessThan(8000)
            }),
          ({ server }) => Effect.promise(() => server.stop(true)),
        ),
      15000,
    )
  }
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
              if (state.mode === "empty-id") return Response.json({ data: [{ ...remote, id: "" }] })
              if (state.mode === "duplicate-id") return Response.json({ data: [remote, remote] })
              if (state.mode === "negative-limit")
                return Response.json({ data: [{ ...remote, max_output_tokens: -1 }] })
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
          for (const mode of ["malformed", "empty-id", "duplicate-id", "negative-limit"]) {
            state.mode = mode
            yield* Effect.promise(() => Bun.sleep(30))
            expect(yield* models.get(Provider.ID.make("gateway"), Model.ID.make(remote.id))).toMatchObject({
              limit: { context: 1_050_000 },
            })
          }
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
