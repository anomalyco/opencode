import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const GroqPlugin = define({
  id: "opencode.provider.groq",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/groq") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/groq"))
        evt.sdk = mod.createGroq(evt.options)
      }),
    )
  }),
})
