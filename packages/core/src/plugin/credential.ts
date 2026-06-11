import { Effect, Scope, Stream } from "effect"
import { EventV2 } from "../event"
import { PluginV2 } from "../plugin"
import { Credential } from "../credential"
import { Connector } from "../connector"

// Depending on what account is active, enable matching providers for that
// service
export const CredentialPlugin = PluginV2.define({
  id: PluginV2.ID.make("credential"),
  effect: Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope

    yield* events.subscribe(Credential.Event.Switched).pipe(
      Stream.runForEach((event) =>
        PluginV2.Service.use((plugin) => plugin.trigger("credential.switched", event.data, {})).pipe(Effect.asVoid),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const active = yield* credentials.activeAll().pipe(Effect.orDie)
        if (active.size === 0) return
        for (const item of evt.provider.list()) {
          const credential = active.get(Connector.ID.make(item.provider.id))
          if (!credential) continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.enabled = {
              via: "credential",
              connector: credential.connectorID,
            }
            if (credential.value.type === "key") {
              provider.request.body.apiKey = credential.value.key
              Object.assign(provider.request.body, credential.value.metadata ?? {})
            }
            if (credential.value.type === "oauth") provider.request.body.apiKey = credential.value.access
          })
        }
      }),
      "credential.switched": Effect.fn(function* () {}),
    }
  }),
})
