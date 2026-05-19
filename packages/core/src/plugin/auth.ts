import { Effect } from "effect"
import { AuthV2 } from "../auth"
import { PluginV2 } from "../plugin"

export const AuthPlugin = PluginV2.define({
  id: PluginV2.ID.make("auth"),
  effect: Effect.gen(function* () {
    const auth = yield* AuthV2.Service
    return {
      "provider.update": Effect.fn(function* (evt) {
        const account = yield* auth.active(AuthV2.ServiceID.make(evt.provider.id)).pipe(Effect.orDie)
        if (!account) return
        evt.provider.enabled = {
          via: "auth",
          service: account.serviceID,
        }
        if (account.credential.type === "api") {
          evt.provider.options.aisdk.provider.apiKey = account.credential.key
          Object.assign(evt.provider.options.aisdk.provider, account.credential.metadata ?? {})
        }
        if (account.credential.type === "oauth") {
          evt.provider.options.aisdk.provider.apiKey = account.credential.access
        }
      }),
    }
  }),
})
