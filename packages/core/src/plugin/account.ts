import { Effect, Scope, Stream } from "effect"
import { EventV2 } from "../event"
import { PluginV2 } from "../plugin"
import { Auth } from "../auth"

// Depending on what account is active, enable matching providers for that
// service
export const AccountPlugin = PluginV2.define({
  id: PluginV2.ID.make("account"),
  effect: Effect.gen(function* () {
    const accounts = yield* Auth.Service
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope

    yield* events.subscribe(Auth.Event.Switched).pipe(
      Stream.runForEach((event) =>
        PluginV2.Service.use((plugin) => plugin.trigger("account.switched", event.data, {})).pipe(Effect.asVoid),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const active = yield* accounts.activeAll().pipe(Effect.orDie)
        if (active.size === 0) return
        for (const item of evt.provider.list()) {
          const account = active.get(Auth.ServiceID.make(item.provider.id))
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
