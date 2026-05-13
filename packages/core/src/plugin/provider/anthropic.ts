import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const AnthropicPlugin = PluginV2.define({
  id: PluginV2.ID.make("anthropic"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.anthropic) return
        evt.provider.options.headers["anthropic-beta"] =
          "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/anthropic") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/anthropic"))
        evt.sdk = mod.createAnthropic(evt.options)
      }),
    }
  }),
})
