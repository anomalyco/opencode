import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { define } from "@opencode-ai/plugin/v2/effect"
import { ProviderV2 } from "../../provider"
import { Integration } from "../../integration"
import { browser, headless } from "./openai-auth"

export const OpenAIPlugin = define({
  id: "openai",
  effect: Effect.fn(function* (ctx) {
    const integrations = yield* Integration.Service
    yield* integrations.transform((draft) => {
      draft.method.update(browser)
      draft.method.update(headless)
    })
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai") continue
          if (!item.models.has(ModelV2.ID.make("gpt-5-chat-latest"))) continue
          evt.model.update(item.provider.id, ModelV2.ID.make("gpt-5-chat-latest"), (model) => {
            // OpenAIPlugin sends OpenAI models through Responses; this alias is a
            // chat-completions-only model, so hide it only from OpenAI's catalog.
            model.enabled = false
          })
        }
      }),
    )
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/openai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai"))
        evt.sdk = mod.createOpenAI(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.openai) return
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
    )
  }),
})
