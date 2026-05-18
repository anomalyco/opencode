import { Effect } from "effect"
import { AccountV2 } from "../account"
import { PluginV2 } from "../plugin"

export const AccountPlugin = PluginV2.define({
  id: PluginV2.ID.make("account"),
  effect: Effect.gen(function* () {
    const accounts = yield* AccountV2.Service
    return {
      "provider.update": Effect.fn(function* (evt) {
        const account = yield* accounts.active(AccountV2.ServiceID.make(evt.provider.id)).pipe(Effect.orDie)
        if (!account) return
        evt.provider.enabled = {
          via: "account",
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
