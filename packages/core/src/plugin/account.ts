import { Effect, Scope, Stream } from "effect"
import { AccountV2 } from "../account"
import { EventV2 } from "../event"
import { PluginV2 } from "../plugin"

export const AccountPlugin = PluginV2.define({
  id: PluginV2.ID.make("account"),
  effect: Effect.gen(function* () {
    const accounts = yield* AccountV2.Service
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope

    yield* events.subscribe(AccountV2.Event.Switched).pipe(
      Stream.runForEach((event) =>
        PluginV2.Service.use((plugin) => plugin.trigger("account.switched", event.data, {})).pipe(Effect.asVoid),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.data) {
          const account = yield* accounts.active(AccountV2.ServiceID.make(item.provider.id)).pipe(Effect.orDie)
          if (!account) continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.enabled = {
              via: "account",
              service: account.serviceID,
            }
            if (account.credential.type === "api") {
              provider.options.aisdk.provider.apiKey = account.credential.key
              Object.assign(provider.options.aisdk.provider, account.credential.metadata ?? {})
            }
            if (account.credential.type === "oauth") provider.options.aisdk.provider.apiKey = account.credential.access
          })
        }
      }),
      "account.switched": Effect.fn(function* () {}),
    }
  }),
})
