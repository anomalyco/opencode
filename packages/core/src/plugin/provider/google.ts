import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"

export const GooglePlugin = define({
  id: "google",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/google") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/google"))
        evt.sdk = mod.createGoogleGenerativeAI(evt.options)
      }),
    )
  }),
})
