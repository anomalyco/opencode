import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"

export const GithubCopilotPlugin = {
  id: "github-copilot",
  effect: Effect.fn(function* (ctx: PluginContext) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const item = evt.provider.get(ProviderV2.ID.githubCopilot)
        if (!item || !item.models.has(ModelV2.ID.make("gpt-5-chat-latest"))) return
        evt.model.update(item.provider.id, ModelV2.ID.make("gpt-5-chat-latest"), (model) => {
          // This chat-only alias conflicts with the Copilot GPT-5 Responses route,
          // so hide it only for Copilot rather than for every provider catalog.
          model.enabled = false
        })
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/github-copilot") return
        const mod = yield* Effect.promise(() => import("../../github-copilot/copilot-provider"))
        evt.sdk = mod.createOpenaiCompatible(evt.options)
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.githubCopilot) return
        if (evt.sdk.responses === undefined && evt.sdk.chat === undefined) {
          evt.language = evt.sdk.languageModel(evt.model.api.id)
          return
        }
        if (evt.options.endpoint === "responses" && evt.sdk.responses) {
          evt.language = evt.sdk.responses(evt.model.api.id)
          return
        }
        if (evt.options.endpoint === "chat" && evt.sdk.chat) {
          evt.language = evt.sdk.chat(evt.model.api.id)
          return
        }
        const match = /^gpt-(\d+)/.exec(evt.model.api.id)
        // Copilot supports Responses for GPT-5 class models, except mini variants
        // which still need the chat-completions endpoint.
        evt.language =
          match && Number(match[1]) >= 5 && !evt.model.api.id.startsWith("gpt-5-mini") && evt.sdk.responses
            ? evt.sdk.responses(evt.model.api.id)
            : evt.sdk.chat(evt.model.api.id)
      }),
    )
  }),
}
