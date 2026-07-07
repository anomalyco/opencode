import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const PerplexityPlugin = define({
  id: "opencode.provider.perplexity",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/perplexity") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/perplexity"))
        evt.sdk = mod.createPerplexity(evt.options)
      }),
    )
  }),
})
