import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"

export const DeepInfraPlugin = define({
  id: "deepinfra",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/deepinfra") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/deepinfra"))
        evt.sdk = mod.createDeepInfra(evt.options)
      }),
    )
  }),
})
