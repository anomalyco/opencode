import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Npm } from "@opencode-ai/util/npm"
import { loadSDKFactory } from "./sdk-factory.js"

export const DynamicProviderPlugin = define({
  id: "opencode.provider.dynamic",
  effect: Effect.fn(function* (ctx) {
    const npm = yield* Npm.Service
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.sdk) return

        evt.sdk = ((yield* loadSDKFactory(npm, evt.package)) as (options: any) => any)(evt.options)
      }),
    )
  }),
})
