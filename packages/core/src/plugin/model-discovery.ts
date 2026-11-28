import { define } from "@opencode/plugin/effect/plugin"
import { ModelDiscovery } from "@opencode/schema/model-discovery"
import { Effect } from "effect"
import { Provider } from "../provider.js"

export const ModelDiscoveryPlugin = define({
  id: "opencode.model-discovery",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    yield* ctx.rpc.register(ModelDiscovery.Definition, { ready: () => providers.discoveryReady }).pipe(Effect.orDie)
  }),
})
