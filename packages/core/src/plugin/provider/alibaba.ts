import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"

export const AlibabaPlugin = define({
  id: "alibaba",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/alibaba") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/alibaba"))
        evt.sdk = mod.createAlibaba(evt.options)
      }),
    )
  }),
})
