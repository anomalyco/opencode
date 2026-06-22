import { Effect } from "effect"
import { define } from "../internal"

export const DeepInfraPlugin = define({
  id: "deepinfra",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/deepinfra") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/deepinfra"))
        evt.sdk = mod.createDeepInfra(evt.options)
      }),
    )
  }),
})
