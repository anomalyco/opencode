import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const AnthropicPlugin = define({
  id: "opencode.provider.anthropic",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (item.provider.api.type !== "aisdk") continue
        if (item.provider.api.package !== "@ai-sdk/anthropic") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.request.headers["anthropic-beta"] =
            "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
        })
      }
    })
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/anthropic") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/anthropic"))
        evt.sdk = mod.createAnthropic(evt.options)
      }),
    )
  }),
})
