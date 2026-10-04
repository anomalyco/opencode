import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { OpenAICompatibleLimitsPlugin } from "@opencode-ai/core/plugin/provider/openai-compatible-limits"

type MutableLimit = { context: number; input?: number | undefined; output: number }

function fakeCatalog(providers: Array<{ id: string; models: Record<string, { api: any; limit: MutableLimit }> }>) {
  const updated: Array<{ providerID: string; modelID: string; limit: MutableLimit }> = []
  const draft = {
    provider: {
      list: () =>
        providers.map((provider) => ({
          provider: { id: provider.id },
          models: new Map(Object.entries(provider.models).map(([id, model]) => [id, { api: model.api }])),
          // the plugin reads mutable limits through the model records
          limitOf: (id: string) => provider.models[id].limit,
        })),
    },
    model: {
      update: (providerID: string, modelID: string, fn: (model: any) => void) => {
        const provider = providers.find((item) => item.id === providerID)
        const model = provider?.models[modelID]
        if (!model) throw new Error(`update on unknown model ${providerID}/${modelID}`)
        const before = JSON.stringify(model.limit)
        fn(model)
        if (JSON.stringify(model.limit) !== before) {
          updated.push({ providerID, modelID, limit: model.limit })
        }
      },
    },
  }
  return { draft, updated }
}

function openAIModel(baseURL: string, apiKey?: string) {
  return {
    api: {
      type: "aisdk" as const,
      package: "@ai-sdk/openai-compatible",
      settings: apiKey ? { baseURL, apiKey } : { baseURL },
    },
  }
}

function configLayer(entries: Config.Entry[]) {
  return Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(entries) }))
}

describe("OpenAICompatibleLimitsPlugin transform", () => {
  it("fills empty limits from the advertisement and keeps explicit config limits", async () => {
    const catalog = fakeCatalog([
      {
        id: "proxy",
        models: {
          "auto-model": { ...openAIModel("https://proxy.test/v1"), limit: { context: 0, output: 0 } },
          "manual-model": { ...openAIModel("https://proxy.test/v1"), limit: { context: 0, output: 0 } },
          "known-model": { ...openAIModel("https://proxy.test/v1"), limit: { context: 128_000, output: 4_096 } },
          "absent-model": { ...openAIModel("https://proxy.test/v1"), limit: { context: 0, output: 0 } },
        },
      },
    ])
    const entry = {
      type: "document" as const,
      info: {
        providers: {
          proxy: {
            models: {
              "manual-model": { limit: { context: 555_000 } },
            },
          },
        },
      },
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "auto-model", context_length: 1_000_000, max_input_tokens: 1_000_000, max_output_tokens: 131_072 },
            { id: "manual-model", context_length: 999_999_999 },
            { id: "known-model", context_length: 999_999_999 },
            { id: "unrelated-model", context_length: 42 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch

    try {
      await Effect.gen(function* () {
        yield* OpenAICompatibleLimitsPlugin.effect({
          catalog: { transform: (callback: (draft: any) => Effect.Effect<void>) => callback(catalog.draft) },
        } as any).pipe(Effect.provide(configLayer([entry as unknown as Config.Entry])), Effect.scoped)
      }).pipe(Effect.runPromise)
    } finally {
      globalThis.fetch = originalFetch
    }

    const byModel = new Map(catalog.updated.map((item) => [item.modelID, item.limit]))
    expect(byModel.get("auto-model")).toEqual({ context: 1_000_000, input: 1_000_000, output: 131_072 })
    // explicit config fields are owned by the config-provider transform; this plugin must not touch them
    expect(byModel.has("manual-model")).toBe(false)
    expect(byModel.has("known-model")).toBe(false)
    expect(byModel.has("absent-model")).toBe(false)
  })

  it("fails open when the endpoint errors and still applies other endpoints", async () => {
    const catalog = fakeCatalog([
      {
        id: "mixed",
        models: {
          "live-model": { ...openAIModel("https://live.test/v1"), limit: { context: 0, output: 0 } },
          "dead-model": { ...openAIModel("https://dead.test/v1"), limit: { context: 0, output: 0 } },
        },
      },
    ])

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any) => {
      if (String(input).includes("dead.test")) return new Response("nope", { status: 500 })
      return new Response(JSON.stringify({ data: [{ id: "live-model", context_length: 200_000 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      await Effect.gen(function* () {
        yield* OpenAICompatibleLimitsPlugin.effect({
          catalog: { transform: (callback: (draft: any) => Effect.Effect<void>) => callback(catalog.draft) },
        } as any).pipe(Effect.provide(configLayer([])), Effect.scoped)
      }).pipe(Effect.runPromise)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(catalog.updated).toEqual([{ providerID: "mixed", modelID: "live-model", limit: { context: 200_000, output: 0 } }])
  })
})
