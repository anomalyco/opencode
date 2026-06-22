import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"

export const TogetherAIPlugin = define({
  id: "togetherai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/togetherai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/togetherai"))
        evt.sdk = mod.createTogetherAI(evt.options)
      }),
    )
  }),
})
