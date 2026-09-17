import { Effect } from "effect"
import { define } from "../internal"

export const GatewayPlugin = define({
  id: "gateway",
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
