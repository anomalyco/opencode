import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const GatewayPlugin = define({
  id: "opencode.provider.gateway",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/gateway") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/gateway"))
        evt.sdk = mod.createGateway(evt.options)
      }),
    )
  }),
})
