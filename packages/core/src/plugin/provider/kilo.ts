import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"

export const KiloPlugin = define({
  id: "opencode.provider.kilo",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.api.url !== "https://api.kilo.ai/api/gateway") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://bolt.ai/"
            provider.request.headers["X-Title"] = "bolt"
          })
        }
      }),
    )
  }),
})
