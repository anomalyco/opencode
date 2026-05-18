import type { Draft } from "immer"
import { Effect } from "effect"
import { AccountV2 } from "../account"
import { Catalog } from "../catalog"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"

export const AccountPlugin = PluginV2.define({
  id: PluginV2.ID.make("account"),
  effect: Effect.gen(function* () {
    const accounts = yield* AccountV2.Service
    const catalog = yield* Catalog.Service
    const apply = (provider: Draft<ProviderV2.Info>, account: AccountV2.Info) => {
      provider.enabled = {
        via: "account",
        service: account.serviceID,
      }
      if (account.credential.type === "api") {
        provider.options.aisdk.provider.apiKey = account.credential.key
        Object.assign(provider.options.aisdk.provider, account.credential.metadata ?? {})
      }
      if (account.credential.type === "oauth") {
        provider.options.aisdk.provider.apiKey = account.credential.access
      }
    }

    return {
      "account.activated": Effect.fn(function* (evt) {
        const next = yield* accounts.get(evt.to).pipe(Effect.orDie)
        if (!next) return
        const previous = evt.from ? yield* accounts.get(evt.from).pipe(Effect.orDie) : undefined
        if (previous && previous.serviceID !== next.serviceID) {
          yield* catalog.provider.update(ProviderV2.ID.make(previous.serviceID), (provider) => {
            provider.enabled = false
          })
        }
        yield* catalog.provider.update(ProviderV2.ID.make(next.serviceID), (provider) => apply(provider, next))
      }),
      "provider.update": Effect.fn(function* (evt) {
        const account = yield* accounts.active(AccountV2.ServiceID.make(evt.provider.id)).pipe(Effect.orDie)
        if (!account) return
        apply(evt.provider, account)
      }),
    }
  }),
})
