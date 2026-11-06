import { expect, test } from "bun:test"
import {
  createDirectoryCacheState,
  directoryCacheEntry,
  transitionDirectoryCache,
  transitionPriorityQueue,
  type DirectoryCacheEvent,
  type DirectoryCacheState,
  type PriorityQueueEvent,
  type PriorityQueueState,
} from "./queue-machine"

const location = { directory: "/repo" }

const lookup = (key: string): DirectoryCacheEvent<string> => ({
  type: "lookup.requested",
  key,
  location,
  directory: key,
})

function cache(events: DirectoryCacheEvent<string>[], state = createDirectoryCacheState<string>()) {
  return events.reduce<{ state: DirectoryCacheState<string>; effects: unknown[] }>(
    (current, event) => {
      const result = transitionDirectoryCache(current.state, event)

      return { state: result.state, effects: [...current.effects, ...result.effects] }
    },
    { state, effects: [] },
  )
}

function queue(events: PriorityQueueEvent[], concurrency: number) {
  return events.reduce<{ state: PriorityQueueState; effects: unknown[] }>(
    (current, event) => {
      const result = transitionPriorityQueue(current.state, event, concurrency)

      return { state: result.state, effects: [...current.effects, ...result.effects] }
    },
    { state: { status: "idle" }, effects: [] },
  )
}

test("a failed folder read leaves the cache, so the next lookup reads it again", () => {
  const failed = cache([lookup("/repo/src"), { type: "lookup.failed", key: "/repo/src", attempt: 1 }])

  expect(failed.effects.at(-1)).toEqual({ type: "resolve", attempt: 1, items: [] })
  expect(directoryCacheEntry(failed.state, "/repo/src")).toBeUndefined()
  expect(transitionDirectoryCache(failed.state, lookup("/repo/src")).effects).toEqual([
    { type: "fetch", key: "/repo/src", attempt: 2, location, directory: "/repo/src" },
  ])
})

test("lookups of one folder share a read, and a late or stale result changes nothing", () => {
  const loading = cache([lookup("/repo/src"), lookup("/repo/src")])
  expect(loading.effects).toEqual([{ type: "fetch", key: "/repo/src", attempt: 1, location, directory: "/repo/src" }])

  const ready = transitionDirectoryCache(loading.state, {
    type: "lookup.succeeded",
    key: "/repo/src",
    attempt: 1,
    items: ["components"],
  }).state

  expect(directoryCacheEntry(ready, "/repo/src")).toEqual({ status: "ready", items: ["components"] })
  expect(transitionDirectoryCache(ready, { type: "lookup.failed", key: "/repo/src", attempt: 1 }).state).toBe(ready)
  expect(transitionDirectoryCache(ready, lookup("/repo/src")).state).toBe(ready)
})

test("closing the dialog aborts every read and ignores what arrives after", () => {
  const disposed = cache([lookup("/repo/src"), { type: "disposed" }])

  expect(disposed.effects.at(-1)).toEqual({ type: "abort-all" })
  expect(
    transitionDirectoryCache(disposed.state, { type: "lookup.succeeded", key: "/repo/src", attempt: 1, items: [] })
      .effects,
  ).toEqual([])
  expect(transitionDirectoryCache(disposed.state, lookup("/repo/lib")).effects).toEqual([])
})

test("clearing the queue cancels queued and running tasks at once without starting a queued one", () => {
  const cleared = queue(
    [
      { type: "scheduled", key: "a", priority: "background" },
      { type: "scheduled", key: "b", priority: "background" },
      { type: "scheduled", key: "c", priority: "user" },
      { type: "cleared" },
    ],
    1,
  )

  expect(cleared.state).toEqual({ status: "idle" })
  expect(cleared.effects).toEqual([
    { type: "start", key: "a" },
    { type: "cancel", keys: ["c", "b", "a"] },
  ])
})

test("an aborted task's slot goes to the newest user task, and its late settle starts nothing", () => {
  const aborted = queue(
    [
      { type: "scheduled", key: "a", priority: "user" },
      { type: "scheduled", key: "b", priority: "background" },
      { type: "scheduled", key: "c", priority: "background" },
      { type: "promoted", key: "c" },
      { type: "aborted", key: "a" },
    ],
    1,
  )

  expect(aborted.effects.slice(1)).toEqual([
    { type: "cancel", keys: ["a"] },
    { type: "start", key: "c" },
  ])
  expect(transitionPriorityQueue(aborted.state, { type: "settled", key: "a" }, 1).state).toBe(aborted.state)
})
