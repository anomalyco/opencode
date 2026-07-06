import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const CoherePlugin = define({
  id: "opencode.provider.cohere",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/cohere") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/cohere"))
        evt.sdk = mod.createCohere(evt.options)
      }),
    )
  }),
})
