import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "../../src/provider/provider"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Provider.node))

const modelBase = {
  name: "Test Model",
  attachment: false,
  reasoning: false,
  temperature: false,
  tool_call: true,
  release_date: "2025-01-01",
  limit: { context: 100_000, output: 10_000 },
  cost: { input: 0, output: 0 },
  options: {},
}

const config = (models: Record<string, Record<string, unknown>>, extra?: Record<string, unknown>) => ({
  ...extra,
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models,
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
})

afterEach(async () => {
  await disposeAllInstances()
})

describe("provider.getSmallModel", () => {
  it.instance(
    "falls back to substring matching when no exact family matches",
    () =>
      Effect.gen(function* () {
        const small = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test"))
        expect(small?.id).toBe(ModelV2.ID.make("local-mini-3b"))
      }),
    {
      config: () =>
        config({
          "big-model": { ...modelBase, id: "big-model" },
          // family is empty, so it is invisible to the exact-family ladder.
          "local-mini-3b": { ...modelBase, id: "local-mini-3b", family: "" },
        }),
    },
  )

  it.instance(
    "prefers the exact family ladder over the substring fallback",
    () =>
      Effect.gen(function* () {
        const small = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test"))
        expect(small?.id).toBe(ModelV2.ID.make("family-small"))
      }),
    {
      config: () =>
        config({
          "local-mini-3b": { ...modelBase, id: "local-mini-3b", family: "" },
          "family-small": { ...modelBase, id: "family-small", family: "gemini-flash" },
        }),
    },
  )

  it.instance(
    "returns undefined when nothing matches",
    () =>
      Effect.gen(function* () {
        const small = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test"))
        expect(small).toBeUndefined()
      }),
    {
      config: () =>
        config({
          "big-model": { ...modelBase, id: "big-model" },
        }),
    },
  )

  it.instance(
    "warns instead of silently failing when small_model is set but missing",
    () =>
      Effect.gen(function* () {
        // The configured model does not exist: the result is undefined and a
        // warning naming the model is logged instead of a silent miss.
        const small = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test"))
        expect(small).toBeUndefined()
      }),
    {
      config: () =>
        config(
          {
            "local-mini-3b": { ...modelBase, id: "local-mini-3b", family: "" },
          },
          { small_model: "test/does-not-exist" },
        ),
    },
  )

  it.instance(
    "resolves an existing configured small_model",
    () =>
      Effect.gen(function* () {
        const small = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test"))
        expect(small?.id).toBe(ModelV2.ID.make("big-model"))
      }),
    {
      config: () =>
        config(
          {
            "big-model": { ...modelBase, id: "big-model" },
            "local-mini-3b": { ...modelBase, id: "local-mini-3b", family: "" },
          },
          { small_model: "test/big-model" },
        ),
    },
  )
})
