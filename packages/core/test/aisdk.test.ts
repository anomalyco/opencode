import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { LLM } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import { expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)
type Fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>

const model = (packageName: string, settings: Record<string, unknown> = {}) =>
  ModelV2.Info.make({
    ...ModelV2.Info.empty(ProviderV2.ID.make("test-provider"), ModelV2.ID.make("catalog-model")),
    modelID: ModelV2.ID.make("api-model"),
    package: ProviderV2.aisdk(packageName),
    settings,
    limit: { context: 100, output: 20 },
  })

it.effect("keys language models by package and flattened overlays", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const loaded: string[] = []
    yield* aisdk.hook.sdk((event) => {
      loaded.push(event.package)
      event.sdk = { languageModel: () => ({ package: event.package }) }
    })

    const first = yield* aisdk.language(model("first", { region: "us-east-1" }))
    const second = yield* aisdk.language(model("second", { region: "us-east-1" }))
    const third = yield* aisdk.language(
      model("second", { region: "us-east-1", fetch: async () => new Response("ok") }),
    )

    expect(first).not.toBe(second)
    expect(second).not.toBe(third)
    expect(loaded).toEqual(["first", "second", "second"])
  }),
)

it.effect("projects request settings, headers, and raw body overlays", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let wrappedFetch: Fetch | undefined
    let body: unknown
    const customFetch: Fetch = async (_input, init) => {
      body = init?.body
      return new Response("ok")
    }
    yield* aisdk.hook.sdk((event) => {
      wrappedFetch = event.options.fetch
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model(
      ModelV2.Info.make({
        ...model("@ai-sdk/google", {
          apiKey: "secret",
          fetch: customFetch,
          thinkingConfig: { thinkingBudget: 1024 },
        }),
        headers: { "x-test": "header" },
        body: { safety_setting: "strict" },
      }),
    )
    const prepared = yield* LLMClient.prepare<LanguageModelV3CallOptions>(
      LLM.request({ model: resolved, prompt: "Hello" }),
    )

    expect(prepared.body.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 1024 } },
    })
    expect(prepared.body.headers).toEqual({ "x-test": "header" })
    expect(wrappedFetch).toBeFunction()
    if (wrappedFetch === undefined) return yield* Effect.die("Expected wrapped fetch")
    const fetchRequest = wrappedFetch
    yield* Effect.promise(() =>
      fetchRequest("https://provider.example", { method: "POST", body: JSON.stringify({ model: "api-model" }) }),
    )
    expect(JSON.parse(String(body))).toEqual({ model: "api-model", safety_setting: "strict" })
  }),
)
