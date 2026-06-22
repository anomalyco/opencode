import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { define } from "@opencode-ai/plugin/v2/effect"

export const OpenRouterPlugin = define({
  id: "openrouter",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@openrouter/ai-sdk-provider") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://opencode.ai/"
            provider.request.headers["X-Title"] = "opencode"
          })
          for (const modelID of [ModelV2.ID.make("gpt-5-chat-latest"), ModelV2.ID.make("openai/gpt-5-chat")]) {
            if (!item.models.has(modelID)) continue
            evt.model.update(item.provider.id, modelID, (model) => {
              // These are OpenRouter-specific OpenAI chat aliases that do not work
              // on the generic path. Keep custom providers with matching IDs untouched.
              model.enabled = false
            })
          }
        }
      }),
    )
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@openrouter/ai-sdk-provider") return
        const mod = yield* Effect.promise(() => import("@openrouter/ai-sdk-provider"))
        evt.sdk = mod.createOpenRouter(evt.options)
      }),
    )
  }),
})
