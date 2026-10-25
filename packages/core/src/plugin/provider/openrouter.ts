import { Effect } from "effect"
import { Model } from "../../model.js"
import { define } from "@opencode/plugin/effect/plugin"

export const OpenRouterPlugin = define({
  id: "opencode.provider.openrouter",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@openrouter/ai-sdk-provider") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://bolt.ai/"
            provider.request.headers["X-Title"] = "bolt"
          })
        }
      }
    })
  }),
})
