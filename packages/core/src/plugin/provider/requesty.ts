import { Effect } from "effect"
import { define } from "../internal"

export const RequestyPlugin = define({
  id: "requesty",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@requesty/ai-sdk") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://opencode.ai/"
            provider.request.headers["X-Title"] = "opencode"
          })
        }
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@requesty/ai-sdk") return
        const mod = yield* Effect.promise(() => import("@requesty/ai-sdk"))
        evt.sdk = mod.createRequesty(evt.options)
      }),
    )
  }),
})
