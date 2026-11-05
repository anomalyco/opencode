export * as ConnectStore from "./store.js"

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { roots } from "@opencode/util/global-roots"

/** Where the connector keeps its sign-in, the workspace config it last fetched, and its cross-process locks. */
export interface Info {
  readonly data: string
  readonly cache: string
  readonly state: string
}

/** The XDG directories for `opencode-connect`, or every directory under `root`. */
export function make(root?: string): Info {
  if (root) return { data: path.join(root, "data"), cache: path.join(root, "cache"), state: path.join(root, "state") }
  const dirs = roots("opencode-connect")
  return { data: dirs.data, cache: dirs.cache, state: dirs.state }
}

export const credentialFile = (store: Info) => path.join(store.data, "credential.json")
export const snapshotFile = (store: Info) => path.join(store.cache, "config.json")
export const lockDir = (store: Info) => path.join(store.state, "locks")

export function read(file: string) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

/**
 * Replaces `file` in one step, readable only by this user like OpenCode's own credential store, so a process reading
 * it concurrently sees the old or the new contents, never a partial write.
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
