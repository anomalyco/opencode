import { Effect } from "effect"
import { ProviderV2 } from "../../provider"
import { define } from "../internal"
import { agentRouterFetch, type AgentRouterFetchLike } from "./agentrouter-fetch"

function isFetchLike(value: unknown): value is AgentRouterFetchLike {
  return typeof value === "function"
}

export const AgentRouterPlugin = define({
  id: "agentrouter",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("agentrouter")) return
        const upstream = isFetchLike(evt.options.fetch) ? evt.options.fetch : undefined
        evt.options.fetch = agentRouterFetch(upstream)
      }),
    )
  }),
})
