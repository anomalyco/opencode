// fork: serializes read-modify-write sequences against the global opencode
// config's provider map. syncLocalProviders, /connect, and /disconnect each
// do getGlobal → mutate → updateGlobal; unserialized, a sync pass racing a
// user connect clobbers one side's write and a manually connected provider
// silently vanishes. Every caller must (re-)read the config INSIDE the locked
// effect — locking around a stale snapshot serializes nothing.
//
// In-process only: two opencode processes can still race each other on the
// config file (file locking is a separate concern).
import { Effect, Semaphore } from "effect"

const lock = Semaphore.makeUnsafe(1)

export function withGlobalConfigLock<A, E, R>(fx: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return lock.withPermits(1)(fx)
}

export * as GlobalConfigLock from "./config-lock"
