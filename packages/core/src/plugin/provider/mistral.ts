import { Effect } from "effect"
import { define } from "../internal"

export const MistralPlugin = define({
  id: "mistral",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/mistral") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/mistral"))
        evt.sdk = mod.createMistral(evt.options)
      }),
    )
  }),
})
