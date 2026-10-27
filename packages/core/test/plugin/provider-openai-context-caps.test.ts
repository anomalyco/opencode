import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpenAIContextCapsPlugin } from "@opencode/core/plugin/provider/openai-context-caps"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const full = { context: 1_050_000, input: 922_000, output: 128_000 }

const setup = Effect.fn(function* (value: Credential.Value) {
  const catalog = yield* Provider.Service
  yield* catalog.transform((catalog) => {
    for (const id of ["gpt-5.5", "gpt-5.6-sol", "gpt-6-luna", "gpt-6.1-sol", "gpt-7"])
      catalog.models.update(Provider.ID.openai, Model.ID.make(id), (model) => {
        model.limit = full
      })
    catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-6.1-sol-fast"), (model) => {
      model.modelID = Model.ID.make("gpt-6.1-sol")
      model.limit = full
    })
    catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-6.2-mini"), (model) => {
      model.limit = { context: 400_000, input: 272_000, output: 128_000 }
    })
  })
  const credentials = yield* Credential.Service
  yield* credentials.create({ integrationID: Integration.ID.make("openai"), value })
  const plugin = yield* Plugin.Service
  yield* OpenAIContextCapsPlugin.effect(yield* PluginHost.make(plugin))
})

const limit = Effect.fn(function* (id: string) {
  const models = yield* Model.Service
  return (yield* models.get(Provider.ID.openai, Model.ID.make(id)))?.limit
})

const oauth = (methodID: string) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make(methodID),
    access: "chatgpt-token",
    refresh: "refresh",
    expires: Date.now() + 60_000,
  })

describe("OpenAIContextCapsPlugin", () => {
  for (const methodID of ["chatgpt-browser", "chatgpt-headless", "chatgpt-token-sharing"])
    it.effect(`caps OpenAI models under ${methodID}`, () =>
      Effect.gen(function* () {
        yield* setup(oauth(methodID))

        const legacy = { context: 400_000, input: 272_000, output: 128_000 }
        const current = { context: 628_000, input: 500_000, output: 128_000 }
        expect(yield* limit("gpt-5.5")).toEqual(legacy)
        expect(yield* limit("gpt-5.6-sol")).toEqual(legacy)
        expect(yield* limit("gpt-6-luna")).toEqual(legacy)
        expect(yield* limit("gpt-6.1-sol")).toEqual(current)
        expect(yield* limit("gpt-6.1-sol-fast")).toEqual(current)
        expect(yield* limit("gpt-7")).toEqual(current)
        expect(yield* limit("gpt-6.2-mini")).toEqual(legacy)
      }),
    )

  it.effect("keeps catalog limits under an API key", () =>
    Effect.gen(function* () {
      yield* setup(Credential.Key.make({ type: "key", key: "sk-test" }))

      expect(yield* limit("gpt-5.6-sol")).toEqual(full)
      expect(yield* limit("gpt-6.1-sol")).toEqual(full)
    }),
  )
})
