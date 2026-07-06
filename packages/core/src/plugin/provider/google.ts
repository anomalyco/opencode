import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const GooglePlugin = define({
  id: "opencode.provider.google",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/google") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/google"))
        evt.sdk = mod.createGoogleGenerativeAI(evt.options)
      }),
    )
  }),
})
