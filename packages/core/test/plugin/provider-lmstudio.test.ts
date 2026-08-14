import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { LMStudioPlugin, make } from "@opencode-ai/core/plugin/provider/lmstudio"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { Provider } from "@opencode-ai/core/provider"
import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

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

describe("LMStudioPlugin", () => {
  it.effect("is registered as a built-in provider plugin", () =>
    Effect.sync(() => {
      expect(LMStudioPlugin.id).toBe("opencode.provider.lmstudio")
      expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.lmstudio")
    }),
  )

  it.live("discovers local language models with their capabilities and effective context", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              models: [
                {
                  type: "llm",
                  key: "google/gemma-4-26b-a4b",
                  display_name: "Gemma 4 26B A4B",
                  architecture: "gemma4",
                  loaded_instances: [{ config: { context_length: 32_768 } }, { config: { context_length: 16_384 } }],
                  max_context_length: 262_144,
                  capabilities: { vision: true, trained_for_tool_use: true },
                },
                {
                  type: "llm",
                  key: "deepseek-r1",
                  display_name: "DeepSeek R1",
                  architecture: "deepseek",
                  loaded_instances: [],
                  max_context_length: 131_072,
                  capabilities: { vision: false, trained_for_tool_use: false },
                },
                {
                  type: "embedding",
                  key: "nomic-embed",
                  display_name: "Nomic Embed",
                  loaded_instances: [],
                  max_context_length: 2048,
                },
              ],
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          yield* addPlugin(server.url.origin)
          const providerID = Provider.ID.make("lmstudio")
          const gemma = yield* eventually(
            catalog.model.get(providerID, Model.ID.make("google/gemma-4-26b-a4b")),
            (model) => model !== undefined,
          )

          expect(yield* catalog.provider.get(providerID)).toEqual({
            id: providerID,
            name: "LM Studio",
            package: "@opencode-ai/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, provider: "lmstudio" },
          })
          expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(providerID)
          expect(gemma).toMatchObject({
            family: "gemma4",
            name: "Gemma 4 26B A4B",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            limit: { context: 16_384, output: 0 },
          })
          expect(yield* catalog.model.get(providerID, Model.ID.make("deepseek-r1"))).toMatchObject({
            capabilities: { tools: false, input: ["text"], output: ["text"] },
            limit: { context: 131_072, output: 0 },
          })
          expect(yield* catalog.model.get(providerID, Model.ID.make("nomic-embed"))).toBeUndefined()
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refreshes the catalog when LM Studio models change", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const models: Array<Record<string, unknown>> = []
        return {
          models,
          server: Bun.serve({ port: 0, fetch: () => Response.json({ models }) }),
        }
      }),
      ({ models, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const providerID = Provider.ID.make("lmstudio")
          yield* addPlugin(server.url.origin, "5 millis")
          expect(yield* catalog.provider.get(providerID)).toBeUndefined()

          models.push({
            type: "llm",
            key: "qwen/qwen3-coder",
            display_name: "Qwen 3 Coder",
            architecture: "qwen3",
            loaded_instances: [],
            max_context_length: 65_536,
            capabilities: { vision: false, trained_for_tool_use: true },
          })
          expect(
            yield* eventually(
              catalog.model.get(providerID, Model.ID.make("qwen/qwen3-coder")),
              (model) => model !== undefined,
            ),
          ).toMatchObject({ name: "Qwen 3 Coder" })

          models.splice(0)
          yield* eventually(catalog.provider.get(providerID), (provider) => provider === undefined)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("shares discovery requests across plugin instances", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests = { count: 0 }
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: () => {
              requests.count++
              return Response.json({
                models: [
                  {
                    type: "llm",
                    key: "shared-model",
                    display_name: "Shared Model",
                    loaded_instances: [],
                    max_context_length: 32_768,
                  },
                ],
              })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          yield* addPlugin(server.url.origin)
          yield* addPlugin(server.url.origin)
          yield* eventually(
            catalog.model.get(Provider.ID.make("lmstudio"), Model.ID.make("shared-model")),
            (model) => model !== undefined,
          )
          expect(requests.count).toBe(1)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
