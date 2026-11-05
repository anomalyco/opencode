import { expect, test } from "bun:test"
import {
  createLocationSyncState,
  LOCATION_SYNC_TIMEOUT,
  missingLocation,
  transitionLocationSync,
  type LocationSyncEffect,
  type LocationSyncEvent,
  type LocationSyncState,
} from "./location-machine"

const deleted = { directory: "/projects/deleted-worktree" }
const other = { directory: "/projects/existing-worktree" }

const target = (location: { directory: string }, connected = true): LocationSyncEvent => ({
  type: "target.updated",
  location,
  connected,
})

function replay(events: LocationSyncEvent[], start: LocationSyncState = createLocationSyncState(deleted)) {
  return events.reduce(
    (result: { state: LocationSyncState; effects: LocationSyncEffect[] }, event) => {
      const next = transitionLocationSync(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: start, effects: [] },
  )
}

const missing = replay([target(deleted), { type: "sync.missing", attempt: 1 }]).state

test("a missing folder stays missing while offline and while reconnecting checks it again", () => {
  expect(missing.status).toBe("missing")
  expect(missingLocation(missing, deleted)).toBe(deleted)

  const offline = transitionLocationSync(missing, target(deleted, false))
  expect(offline.state).toBe(missing)
  expect(offline.effects).toEqual([])

  const checking = transitionLocationSync(missing, target(deleted))
  expect(checking.state).toEqual({ status: "syncing", attempt: 2, retries: 0, location: deleted, missing: true })
  expect(checking.effects).toEqual([{ type: "sync", attempt: 2, location: deleted, timeout: LOCATION_SYNC_TIMEOUT }])
  expect(missingLocation(checking.state, deleted)).toBe(deleted)

  expect(replay([{ type: "sync.missing", attempt: 2 }], checking.state).state.status).toBe("missing")
  // Neither a dropped connection nor transient failures prove the folder came back.
  expect(replay([target(deleted, false)], checking.state).state).toEqual({
    status: "missing",
    attempt: 3,
    location: deleted,
  })
  const exhausted = replay(
    [
      { type: "sync.failed", attempt: 2 },
      { type: "retry.due", attempt: 3 },
      { type: "sync.timed-out", attempt: 3 },
      { type: "retry.due", attempt: 4 },
      { type: "sync.failed", attempt: 4 },
    ],
    checking.state,
  )
  expect(exhausted.state.status).toBe("missing")
  expect(missingLocation(exhausted.state, deleted)).toBe(deleted)
})

test("a folder that comes back clears the missing view as soon as the server resolves it", () => {
  const checking = transitionLocationSync(missing, target(deleted)).state
  const resolved = transitionLocationSync(checking, { type: "info.resolved", attempt: 2 }).state
  expect(missingLocation(resolved, deleted)).toBeUndefined()
  expect(transitionLocationSync(resolved, { type: "sync.succeeded", attempt: 2 }).state.status).toBe("synced")
})

test("switching Location drops the previous one's missing state at once", () => {
  expect(missingLocation(missing, other)).toBeUndefined()

  const switched = transitionLocationSync(missing, target(other))
  expect(switched.state).toEqual({ status: "syncing", attempt: 2, retries: 0, location: other, missing: false })
  expect(transitionLocationSync(switched.state, { type: "sync.missing", attempt: 1 }).state).toBe(switched.state)

  const offline = transitionLocationSync(missing, target(other, false))
  expect(offline.state).toEqual({ status: "idle", attempt: 2, location: other })
  expect(missingLocation(offline.state, other)).toBeUndefined()
})

test("generic failures back off twice and then fail without reporting a missing folder", () => {
  const result = replay([
    target(deleted),
    { type: "sync.failed", attempt: 1 },
    { type: "retry.due", attempt: 2 },
    { type: "sync.failed", attempt: 2 },
    { type: "retry.due", attempt: 3 },
    { type: "sync.failed", attempt: 3 },
  ])
  expect(result.effects.filter((effect) => effect.type !== "sync")).toEqual([
    { type: "retry", attempt: 2, delay: 500 },
    { type: "retry", attempt: 3, delay: 1_000 },
    { type: "timer.clear" },
  ])
  expect(result.effects.filter((effect) => effect.type === "sync")).toHaveLength(3)
  expect(result.state).toEqual({ status: "failed", attempt: 3, location: deleted })
  expect(missingLocation(result.state, deleted)).toBeUndefined()
})

test("a timed-out attempt retries and ignores its late result", () => {
  const timedOut = replay([target(deleted), { type: "sync.timed-out", attempt: 1 }]).state
  expect(timedOut).toEqual({ status: "waiting-retry", attempt: 2, retries: 1, location: deleted, missing: false })

  for (const type of ["sync.succeeded", "sync.failed", "sync.missing"] as const)
    expect(transitionLocationSync(timedOut, { type, attempt: 1 }).state).toBe(timedOut)
})

test("a settled Location syncs again after reconnecting", () => {
  const synced = replay([target(deleted), { type: "sync.succeeded", attempt: 1 }]).state
  expect(transitionLocationSync(synced, target(deleted)).state).toBe(synced)

  const result = replay([target(deleted, false), target(deleted)], synced)
  expect(result.state).toEqual({ status: "syncing", attempt: 3, retries: 0, location: deleted, missing: false })
  expect(result.effects).toEqual([{ type: "sync", attempt: 3, location: deleted, timeout: LOCATION_SYNC_TIMEOUT }])
})

test("disposal clears a pending timer and ignores everything after it", () => {
  const syncing = replay([target(deleted)]).state
  const disposed = transitionLocationSync(syncing, { type: "disposed" })
  expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "timer.clear" }] })
  expect(transitionLocationSync(missing, { type: "disposed" }).effects).toEqual([])

  for (const event of [target(deleted), { type: "sync.succeeded", attempt: 1 }] satisfies LocationSyncEvent[])
    expect(transitionLocationSync(disposed.state, event).state).toBe(disposed.state)
})
