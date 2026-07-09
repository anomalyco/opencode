import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ProviderV2 } from "../../provider"

export const VercelPlugin = define({
  id: "opencode.provider.vercel",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!ProviderV2.isAISDK(item.provider.package)) continue
        if (ProviderV2.packageName(item.provider.package) !== "@ai-sdk/vercel") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "http-referer": "https://opencode.ai/", "x-title": "opencode" }
        })
      }
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/vercel") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/vercel"))
        evt.sdk = mod.createVercel(evt.options)
      }),
    )
  }),
})
