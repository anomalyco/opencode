import { Effect } from "effect"
import { define } from "../internal"

export const EdenAiPlugin = define({
  id: "edenai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.api.url !== "https://api.edenai.run/v3") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://opencode.ai/"
            provider.request.headers["X-Title"] = "opencode"
          })
        }
      }),
    )
  }),
})
