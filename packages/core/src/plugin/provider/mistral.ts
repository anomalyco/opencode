import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const MistralPlugin = define({
  id: "opencode.provider.mistral",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/mistral") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/mistral"))
        evt.sdk = mod.createMistral(evt.options)
      }),
    )
  }),
})
