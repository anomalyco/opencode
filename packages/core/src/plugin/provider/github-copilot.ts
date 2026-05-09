import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

function shouldUseResponses(modelID: string) {
  // Copilot supports Responses for GPT-5 class models, except mini variants
  // which still need the chat-completions endpoint.
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const GithubCopilotPlugin = PluginV2.define({
  id: PluginV2.ID.make("github-copilot"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.githubCopilot) return
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/github-copilot") return
        const mod = yield* Effect.promise(() => import("../../github-copilot/copilot-provider"))
        evt.sdk = mod.createOpenaiCompatible(evt.options)
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.githubCopilot) return
        if (evt.sdk.responses === undefined && evt.sdk.chat === undefined) {
          evt.language = evt.sdk.languageModel(evt.model.apiID)
          return
        }
        evt.language = shouldUseResponses(evt.model.apiID)
          ? evt.sdk.responses(evt.model.apiID)
          : evt.sdk.chat(evt.model.apiID)
      }),
      "model.update": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.githubCopilot) return
        // This chat-only alias conflicts with the Copilot GPT-5 Responses route,
        // so hide it only for Copilot rather than for every provider catalog.
        if (evt.model.id === ModelV2.ID.make("gpt-5-chat-latest")) evt.cancel = true
      }),
    }
  }),
})
