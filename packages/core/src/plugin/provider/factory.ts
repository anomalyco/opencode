import { define } from "@opencode-ai/plugin/effect/plugin"
import type { AISDKHooks } from "@opencode-ai/plugin/effect/aisdk"
import { Effect } from "effect"

export function createProviderPlugin(input: {
  readonly id: string
  readonly package: string
  readonly load: (options: AISDKHooks["sdk"]["options"]) => Promise<unknown>
}) {
  return define({
    id: input.id,
    effect: Effect.fn(function* (ctx) {
      yield* ctx.aisdk.hook(
        "sdk",
        Effect.fn(function* (evt) {
          if (evt.package !== input.package) return
          evt.sdk = yield* Effect.promise(() => input.load(evt.options))
        }),
      )
    }),
  })
}
