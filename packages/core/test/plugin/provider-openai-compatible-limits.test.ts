import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import {
  mergeAdvertisedLimit,
  OpenAICompatibleLimitsPlugin,
  parseModelLimits,
} from "@opencode/core/plugin/provider/openai-compatible-limits"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { Document, type Entry, Info } from "@opencode/schema/config"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)

const addPlugins = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  const config = Config.testLayer(entries)
  yield* OpenAICompatibleLimitsPlugin.effect(host).pipe(Effect.provide(config))
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(config))
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

function configuration(id: string, baseURL: string, models: Record<string, unknown>): Entry {
  return new Document({
    type: "document",
    info: decode({
      providers: {
        [id]: {
          name: "Proxy",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL, apiKey: "secret" },
          models,
        },
      },
    }),
  })
}

describe("OpenAICompatibleLimitsPlugin", () => {
  test("is registered as a built-in provider plugin", () => {
    expect(OpenAICompatibleLimitsPlugin.id).toBe("opencode.provider.openai-compatible-limits")
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.openai-compatible-limits")
  })

  describe("parseModelLimits", () => {
    test("reads limits from an OpenAI-compatible /models body", () => {
      expect(
        parseModelLimits({
          data: [
            {
              id: "factory-capable",
              context_length: 1_000_000,
              max_input_tokens: 1_000_000,
              max_output_tokens: 131_072,
            },
            { id: "factory-efficient", context_length: 262_144, max_input_tokens: 230_144 },
            { id: "no-limits" },
          ],
        }),
      ).toEqual({
        "factory-capable": { context: 1_000_000, input: 1_000_000, output: 131_072 },
        "factory-efficient": { context: 262_144, input: 230_144 },
      })
    })

    test("ignores malformed entries and non-array bodies", () => {
      expect(parseModelLimits({ data: [{ context_length: 100 }, { id: "", context_length: 100 }, { id: "x" }] })).toEqual({})
      expect(parseModelLimits({})).toEqual({})
      expect(parseModelLimits(null)).toEqual({})
      expect(parseModelLimits({ data: [{ id: "neg", context_length: -1 }, { id: "float", context_length: 1.5 }] })).toEqual({})
    })
  })

  describe("mergeAdvertisedLimit", () => {
    test("fills placeholder and absent fields from the advertisement", () => {
      expect(
        mergeAdvertisedLimit(
          { context: 200_000, output: 32_000 },
          { context: 1_000_000, input: 1_000_000, output: 131_072 },
        ),
      ).toEqual({ context: 1_000_000, input: 1_000_000, output: 131_072 })
      expect(mergeAdvertisedLimit({ context: 0, output: 0 }, { context: 8_192 })).toEqual({ context: 8_192, output: 0 })
    })

    test("never overwrites real limits", () => {
      expect(
        mergeAdvertisedLimit(
          { context: 128_000, input: 120_000, output: 4_096 },
          { context: 1_000_000, input: 1_000_000, output: 131_072 },
        ),
      ).toBeUndefined()
    })

    test("fills per field, keeping partial real data", () => {
      expect(mergeAdvertisedLimit({ context: 128_000, output: 32_000 }, { context: 999_999, output: 131_072 })).toEqual({
        context: 128_000,
        output: 131_072,
      })
    })

    test("does nothing when the advertisement has no usable fields", () => {
      expect(mergeAdvertisedLimit({ context: 200_000, output: 32_000 }, {})).toBeUndefined()
    })
  })

  it.live(
    "fills placeholder limits from the advertisement and keeps configured limits",
    () =>
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
                return Response.json({
                  data: [
                    {
                      id: "auto-model",
                      context_length: 1_000_000,
                      max_input_tokens: 1_000_000,
                      max_output_tokens: 131_072,
                    },
                    { id: "manual-model", context_length: 999_999_999 },
                  ],
                })
              },
            }),
          }
        }),
        ({ requests, server }) =>
          Effect.gen(function* () {
            const modelState = yield* Model.Service
            const providerID = Provider.ID.make("proxy")
            yield* addPlugins([
              configuration("proxy", `${server.url.origin}/v1`, {
                "auto-model": {},
                "manual-model": { limit: { context: 555_000 } },
              }),
            ])

            const auto = yield* eventually(
              modelState.get(providerID, Model.ID.make("auto-model")),
              (model) => model?.limit.context === 1_000_000,
            )
            expect(auto?.limit).toEqual({ context: 1_000_000, input: 1_000_000, output: 131_072 })
            expect(requests).toContainEqual({ authorization: "Bearer secret", path: "/v1/models" })

            const manual = yield* modelState.get(providerID, Model.ID.make("manual-model"))
            expect(manual?.limit.context).toBe(555_000)
          }),
        ({ server }) => Effect.promise(() => server.stop(true)),
      ),
  )

  it.live("fails open on erroring endpoints and still applies live ones", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const dead = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 500 }) })
        const live = Bun.serve({
          port: 0,
          fetch: () => Response.json({ data: [{ id: "live-model", context_length: 200_001 }] }),
        })
        return { dead, live }
      }),
      ({ dead, live }) =>
        Effect.gen(function* () {
          const modelState = yield* Model.Service
          yield* addPlugins([
            configuration("live-proxy", `${live.url.origin}/v1`, { "live-model": {} }),
            configuration("dead-proxy", `${dead.url.origin}/v1`, { "dead-model": {} }),
          ])

          expect(
            yield* eventually(
              modelState.get(Provider.ID.make("live-proxy"), Model.ID.make("live-model")),
              (model) => model?.limit.context === 200_001,
            ),
          ).toBeDefined()
          expect(
            yield* eventually(
              modelState.get(Provider.ID.make("dead-proxy"), Model.ID.make("dead-model")),
              (model) => model !== undefined,
            ),
          ).toMatchObject({ limit: { context: 200_000, output: 32_000 } })
        }),
      ({ dead, live }) => Effect.promise(() => Promise.all([dead.stop(true), live.stop(true)])),
    ),
  )
})
