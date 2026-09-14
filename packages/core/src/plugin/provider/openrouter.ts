import { Effect } from "effect"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { define } from "@opencode/plugin/effect/plugin"

export const OpenRouterPlugin = define({
  id: "opencode.provider.openrouter",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@openrouter/ai-sdk-provider") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" }
        })
      }
    })
    yield* ctx.model.transform((models) => {
      for (const item of models.provider.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@openrouter/ai-sdk-provider") continue
        for (const modelID of [Model.ID.make("gpt-5-chat-latest"), Model.ID.make("openai/gpt-5-chat")]) {
          if (!models.get(item.provider.id, modelID)) continue
          models.update(item.provider.id, modelID, (model) => {
            // These are OpenRouter-specific OpenAI chat aliases that do not work
            // on the generic path. Keep custom providers with matching IDs untouched.
            model.enabled = false
          })
        }
      }
    })
  }),
})
