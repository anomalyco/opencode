import { Effect, Stream } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import type { Provider } from "../../provider.js"

/**
 * Tracks provider settings a plugin derives from the active connection's stored credential, such as login form
 * answers kept as credential metadata. The model resolver does not pass credential metadata to packages, so a
 * plugin that needs it applies these settings in its provider transform. A credential update or switch reloads
 * providers when the derived settings change.
 */
export const credentialSettings = Effect.fn("ProviderPlugin.credentialSettings")(function* (
  ctx: Context,
  integrationID: string,
  select: (value: Credential.Value) => Provider.Settings,
) {
  const credentials = yield* Credential.Service
  const bus = yield* Bus.Service
  const load = Effect.fn("ProviderPlugin.credentialSettings.load")(function* () {
    const connection = yield* ctx.integration.connection.active(integrationID)
    // Reads the stored value rather than resolving the connection, so startup never refreshes anything.
    const stored =
      connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
    return stored ? select(stored.value) : {}
  })
  const current = { settings: yield* load() }
  yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
    Stream.runForEach(() =>
      Effect.gen(function* () {
        const next = yield* load()
        if (JSON.stringify(next) === JSON.stringify(current.settings)) return
        current.settings = next
        yield* ctx.provider.reload()
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  return current
})

/** Picks the string metadata entries a provider package accepts as settings. */
export function metadataSettings(metadata: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => (typeof metadata?.[key] === "string" && metadata[key] !== "" ? [[key, metadata[key]]] : [])),
  )
}
