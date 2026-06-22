import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"

export const VenicePlugin = define({
  id: "venice",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "venice-ai-sdk-provider") return
        const mod = yield* Effect.promise(() => import("venice-ai-sdk-provider"))
        evt.sdk = mod.createVenice(evt.options)
      }),
    )
  }),
})
