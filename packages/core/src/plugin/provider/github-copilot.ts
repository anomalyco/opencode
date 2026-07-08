import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ProviderV2 } from "../../provider"

function shouldUseResponses(modelID: string) {
  // Copilot supports Responses for GPT-5 class models, except mini variants
  // which still need the chat-completions endpoint.
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const GithubCopilotPlugin = define({
  id: "opencode.provider.github-copilot",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(ProviderV2.ID.githubCopilot)
      if (!item || !item.models.has(ModelV2.ID.make("gpt-5-chat-latest"))) return
      evt.model.update(item.provider.id, ModelV2.ID.make("gpt-5-chat-latest"), (model) => {
        // This chat-only alias conflicts with the Copilot GPT-5 Responses route,
        // so hide it only for Copilot rather than for every provider catalog.
        model.enabled = false
      })
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/github-copilot") return
        const mod = yield* Effect.promise(() => import("../../github-copilot/copilot-provider"))
        evt.sdk = mod.createOpenaiCompatible(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.githubCopilot) return
        if (evt.sdk.responses === undefined && evt.sdk.chat === undefined) {
          evt.language = evt.sdk.languageModel(evt.model.modelID ?? evt.model.id)
          return
        }
        if (evt.options.endpoint === "responses" && evt.sdk.responses) {
          evt.language = evt.sdk.responses(evt.model.modelID ?? evt.model.id)
          return
        }
        if (evt.options.endpoint === "chat" && evt.sdk.chat) {
          evt.language = evt.sdk.chat(evt.model.modelID ?? evt.model.id)
          return
        }
        const id = evt.model.modelID ?? evt.model.id
        evt.language = shouldUseResponses(id) ? evt.sdk.responses(id) : evt.sdk.chat(id)
      }),
    )
  }),
})
