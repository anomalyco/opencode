import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const CerebrasPlugin = define({
  id: "opencode.provider.cerebras",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (item.provider.api.type !== "aisdk") continue
        if (item.provider.api.package !== "@ai-sdk/cerebras") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.request.headers["X-Cerebras-3rd-Party-Integration"] = "opencode"
        })
      }
    })
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/cerebras") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/cerebras"))
        evt.sdk = mod.createCerebras(evt.options)
      }),
    )
  }),
})
