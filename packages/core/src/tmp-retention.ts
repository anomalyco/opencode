export * as TmpRetention from "./tmp-retention.js"

import fs from "node:fs/promises"
import path from "path"
import { Duration, Effect, Layer, Schedule } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"

export const RETENTION = Duration.days(7)

// Directories whose entries are independent of each other, such as one upload or one session's images.
const CONTAINERS = new Set(["uploads", "images"])

/**
 * Whether nothing under `target` was created or changed before `cutoff`. Stops at the first recent entry, so a
 * tree in use costs a few stats. ctime counts as well as mtime: extracting an archive or copying with `-p` keeps
 * old mtimes, but every new file gets a fresh ctime. A time of 0 (unset, as on workerd) counts as recent.
 */
async function stale(target: string, cutoff: number): Promise<boolean> {
  const info = await fs.lstat(target).catch(() => undefined)
  if (!info) return false
  const changed = Math.max(info.mtimeMs, info.ctimeMs)
  if (!(changed > 0) || changed >= cutoff) return false
  if (!info.isDirectory()) return true
  const entries = await fs.readdir(target).catch(() => undefined)
  if (!entries) return false
  for (const entry of entries) if (!(await stale(path.join(target, entry), cutoff))) return false
  return true
}

/** Each top-level entry is one unit, except in containers, where each child is. */
async function units(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name)
      if (!entry.isDirectory() || !CONTAINERS.has(entry.name)) return [target]
      return (await fs.readdir(target).catch(() => [])).map((name) => path.join(target, name))
    }),
  )
  return nested.flat()
}

/**
 * Deletes each unit under `directory` that nothing touched for `RETENTION`, whole, so a project left there is
 * never deleted in part while part of it is still in use.
 */
export const cleanup = Effect.fn("TmpRetention.cleanup")(function* (directory: string, now?: number) {
  yield* Effect.promise(async () => {
    const cutoff = (now ?? Date.now()) - Duration.toMillis(RETENTION)
    for (const unit of await units(directory)) {
      if (await stale(unit, cutoff)) await fs.rm(unit, { recursive: true, force: true }).catch(() => {})
    }
  })
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const global = yield* Global.Service
    yield* cleanup(global.tmp).pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped)
  }),
)

export const node = makeGlobalNode({
  name: "tmp-retention",
  layer,
  deps: [Global.node],
})
