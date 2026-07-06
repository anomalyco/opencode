import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const OpenAICompatiblePlugin = define({
  id: "opencode.provider.openai-compatible",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.sdk) return
        if (!evt.package.includes("@ai-sdk/openai-compatible")) return
        if (evt.options.includeUsage !== false) evt.options.includeUsage = true
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(evt.options as any)
      }),
    )
  }),
})
