export * as ConsoleCredentials from "./credentials.js"

import { Hash } from "@opencode/util/hash"
import { ConsoleAccess } from "@opencode/core/console-access"
import { Credential } from "@opencode/schema/credential"
import { Clock, Duration, Effect, Fiber, Option, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { ConnectStore } from "./store.js"

/** Device sign-ins start and refresh as this client, so the Console can tell connector sessions from OpenCode's. */
export const clientID = "opencode-connect"

export type Current = Credential.OAuth | Credential.Key

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Credential.OAuth))
// Refresh a minute early so a token handed to a harness doesn't expire in flight.
const EXPIRY_MARGIN_MS = 60_000

/**
 * `OPENCODE_API_KEY` (CI and headless runs) wins over a stored device sign-in. A key uses the default Console unless
 * `OPENCODE_CONNECT_SERVER` names another.
 */
export function read(store: ConnectStore.Info): Current | undefined {
  const key = process.env.OPENCODE_API_KEY
  const server = process.env.OPENCODE_CONNECT_SERVER
  if (key) return Credential.Key.make({ type: "key", key, ...(server ? { metadata: { server } } : {}) })
  return stored(store)
}

/** The stored device sign-in, ignoring `OPENCODE_API_KEY`. */
export function stored(store: ConnectStore.Info) {
  return Option.getOrUndefined(decode(ConnectStore.read(ConnectStore.credentialFile(store)) ?? ""))
}

/**
 * Identifies the member and workspace a credential acts as, so a workspace config is only ever reused for the
 * sign-in it was fetched for. API keys carry no account or workspace, so a fingerprint of the key stands in.
 */
export function owner(credential: Current) {
  return JSON.stringify([
    ConsoleAccess.server(credential),
    credential.type === "key" ? Hash.sha256(credential.key).slice(0, 16) : credential.metadata?.accountID,
    credential.metadata?.orgID,
  ])
}

/** Runs the Console's device sign-in, asking `prompt` to show the code, and stores the new credential. */
export const login = Effect.fn("ConsoleCredentials.login")(function* (
  store: ConnectStore.Info,
  http: HttpClient.HttpClient,
  input: { readonly server: string; readonly prompt: (device: { url: string; code: string }) => Effect.Effect<void> },
) {
  const device = yield* ConsoleAccess.authorize(http, input.server, clientID)
  yield* input.prompt(device)
  const credential = yield* device.callback
  const previous = yield* ConnectStore.locked(
    store,
    Effect.sync(() => {
      const previous = stored(store)
      ConnectStore.write(ConnectStore.credentialFile(store), JSON.stringify(credential))
      // Signing in again to the same workspace keeps its config, so its policies hold until the next fetch.
      if (!previous || owner(previous) !== owner(credential)) ConnectStore.remove(ConnectStore.snapshotFile(store))
      return previous
    }),
  )
  if (previous) yield* ConsoleAccess.revoke(http, previous, clientID).pipe(Effect.ignore)
  return credential
})

/**
 * The current credential with an access token that won't expire for at least a minute, refreshing it when needed.
 *
 * Console refresh tokens are single-use and reusing one signs the member out of the connector, while harnesses call
 * it from many processes at once. A refresh therefore runs under the store's lock, re-reads the credential another
 * process may already have rotated, and runs detached: a caller that stops waiting, such as a policy check with a
 * deadline, can't cancel a rotation the Console may already have accepted before the new tokens are saved.
 */
export const fresh = Effect.fn("ConsoleCredentials.fresh")(function* (
  store: ConnectStore.Info,
  http: HttpClient.HttpClient,
) {
  const current = read(store)
  if (!current || current.type === "key" || !(yield* expiring(current))) return current
  const rotation = yield* ConnectStore.locked(
    store,
    Effect.gen(function* () {
      const latest = stored(store)
      if (!latest || !(yield* expiring(latest))) return latest
      const refreshed = yield* ConsoleAccess.refresh(http, latest, clientID).pipe(Effect.timeout(Duration.seconds(10)))
      ConnectStore.write(ConnectStore.credentialFile(store), JSON.stringify(refreshed))
      return refreshed
    }),
  ).pipe(Effect.forkDetach)
  return yield* Fiber.join(rotation)
})

/** Forgets the stored sign-in and its workspace config, and ends the session on the Console when it can. */
export const logout = Effect.fn("ConsoleCredentials.logout")(function* (
  store: ConnectStore.Info,
  http: HttpClient.HttpClient,
) {
  const previous = yield* ConnectStore.locked(
    store,
    Effect.sync(() => {
      const previous = stored(store)
      ConnectStore.remove(ConnectStore.credentialFile(store))
      ConnectStore.remove(ConnectStore.snapshotFile(store))
      return previous
    }),
  )
  if (!previous) return false
  // Signing out locally must not depend on reaching the Console.
  yield* ConsoleAccess.revoke(http, previous, clientID).pipe(Effect.ignore)
  return true
})

function expiring(credential: Credential.OAuth) {
  return Clock.currentTimeMillis.pipe(Effect.map((now) => credential.expires - EXPIRY_MARGIN_MS <= now))
}
