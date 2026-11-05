export * as ConnectStore from "./store.js"

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Flock } from "@opencode/util/flock"
import { roots } from "@opencode/util/global-roots"
import { Effect } from "effect"

/** Where the connector keeps its sign-in and the workspace config it last fetched. */
export interface Info {
  readonly data: string
  readonly cache: string
}

/** The XDG directories for `opencode-connect`, or every directory under `root`. */
export function make(root?: string): Info {
  if (root) return { data: path.join(root, "data"), cache: path.join(root, "cache") }
  const dirs = roots("opencode-connect")
  return { data: dirs.data, cache: dirs.cache }
}

export const credentialFile = (store: Info) => path.join(store.data, "credential.json")
export const snapshotFile = (store: Info) => path.join(store.cache, "config.json")
export const syncClaimFile = (store: Info) => path.join(store.cache, "sync.claim")

/**
 * Runs `body` holding the lock every change to the stored sign-in or its workspace config takes, across processes.
 * It sits beside the credential, so processes launched with different state or cache directories still share it.
 */
export function locked<A, E, R>(store: Info, body: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      // A lock left by a crashed process goes stale after 10 seconds without its heartbeat; the work it guards is a
      // single request with a 10 second timeout.
      try: () =>
        Flock.acquire("credential", { dir: path.join(store.data, "locks"), staleMs: 10_000, timeoutMs: 30_000 }),
      catch: (cause) =>
        new Error("Timed out after 30s waiting for another opencode-connect process to update the sign-in", { cause }),
    }),
    () => body,
    (lease) => Effect.promise(() => lease.release()),
  )
}

export function read(file: string) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

/** When `file` last changed, in epoch milliseconds, or `undefined` when it doesn't exist. */
export function modified(file: string) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * Replaces `file` in one step, readable only by this user, so a process reading it concurrently sees the old or the
 * new contents, never a partial write.
 */
export function write(file: string, contents: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, contents, { mode: 0o600 })
  renameSync(temporary, file)
}

export function remove(file: string) {
  rmSync(file, { force: true })
}
