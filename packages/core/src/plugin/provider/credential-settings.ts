import { Effect } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Credential } from "../../credential.js"
import type { Provider } from "../../provider.js"
import { ProviderRefresh } from "./refresh.js"

/** Resolves the integration's active connection to its credential, or undefined when it cannot be resolved. */
export const activeCredential = Effect.fnUntraced(function* (
  ctx: Context,
  integrationID: string,
): Effect.fn.Return<{
  readonly connection: Effect.Success<ReturnType<Context["integration"]["connection"]["active"]>>
  readonly credential: Credential.Value | undefined
}> {
  const connection = yield* ctx.integration.connection.active(integrationID)
  const credential = connection
    ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
    : undefined
  return { connection, credential }
})

/**
 * Tracks provider settings a plugin derives from the active connection's stored credential, such as login form
 * answers kept as credential metadata. The model resolver does not pass credential metadata to packages, so a
 * plugin that needs it applies these settings in its provider transform. Switching this integration's active
 * credential reloads providers when the derived settings change.
 */
export const credentialSettings = Effect.fn("ProviderPlugin.credentialSettings")(function* (
  ctx: Context,
  integrationID: string,
  select: (value: Credential.Value) => Provider.Settings,
) {
  const credentials = yield* Credential.Service
  const load = Effect.fn("ProviderPlugin.credentialSettings.load")(function* () {
    const connection = yield* ctx.integration.connection.active(integrationID)
    // Reads the stored value rather than resolving the connection, so startup never refreshes anything.
    const stored =
      connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
    return stored ? select(stored.value) : {}
  })
  const current = { settings: yield* load() }
  yield* ProviderRefresh.onSwitch(
    integrationID,
    Effect.gen(function* () {
      const next = yield* load()
      if (JSON.stringify(next) === JSON.stringify(current.settings)) return
      current.settings = next
      yield* ctx.provider.reload()
    }),
  )
  return current
})

/** Picks the string metadata entries a provider package accepts as settings. */
export function metadataSettings(metadata: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => (typeof metadata?.[key] === "string" && metadata[key] !== "" ? [[key, metadata[key]]] : [])),
  )
}
