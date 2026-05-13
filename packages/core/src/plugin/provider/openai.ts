import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const OpenAIPlugin = PluginV2.define({
  id: PluginV2.ID.make("openai"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/openai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai"))
        evt.sdk = mod.createOpenAI(evt.options)
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.openai) return
        evt.language = evt.sdk.responses(evt.model.apiID)
      }),
      "model.update": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.openai) return
        // OpenAIPlugin sends OpenAI models through Responses; this alias is a
        // chat-completions-only model, so remove it only from OpenAI's catalog.
        if (evt.model.id === ModelV2.ID.make("gpt-5-chat-latest")) evt.cancel = true
      }),
    }
  }),
})
