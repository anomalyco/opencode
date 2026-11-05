import { expect, test } from "bun:test"
import type { ClosedTab } from "./closed"
import {
  createTabsHydrationState,
  selectRecentTabKey,
  transitionTabsHydration,
  type ClosedTabOp,
  type TabsHydrationEvent,
} from "./hydration-machine"

const HYDRATING = createTabsHydrationState({ recent: false, closed: false })

const replay = (events: TabsHydrationEvent[], state = HYDRATING) =>
  events.reduce(
    (current, event) => {
      const next = transitionTabsHydration(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] as unknown[] },
  )

test("a recent key written before the store loads reads back at once and lands once it loads", () => {
  const written = replay([{ type: "recent.set", key: "tab-a", persistedKey: undefined }])
  expect(selectRecentTabKey(written.state, undefined)).toBe("tab-a")

  const loaded = replay([{ type: "recent.hydrated", persistedKey: "tab-old" }], written.state)
  expect(loaded.effects).toEqual([{ type: "recent.commit", key: "tab-a" }])
  expect(selectRecentTabKey(loaded.state, "tab-a")).toBe("tab-a")
})

test("clearing the recent key before the store loads wins over the stored key", () => {
  const cleared = replay([
    { type: "recent.set", key: "tab-a", persistedKey: undefined },
    { type: "recent.set", key: undefined, persistedKey: undefined },
  ])
  expect(selectRecentTabKey(cleared.state, "tab-old")).toBeUndefined()

  expect(replay([{ type: "recent.hydrated", persistedKey: "tab-old" }], cleared.state).effects).toEqual([
    { type: "recent.commit", key: undefined },
  ])
})

test("without a write, the stored key shows once it loads", () => {
  const loaded = replay([{ type: "recent.hydrated", persistedKey: "tab-old" }])

  expect(loaded.effects).toEqual([])
  expect(selectRecentTabKey(loaded.state, "tab-old")).toBe("tab-old")
  expect(replay([{ type: "recent.set", key: "tab-b", persistedKey: "tab-old" }], loaded.state).effects).toEqual([
    { type: "recent.commit", key: "tab-b" },
  ])
})

test("closed tab operations queued before the store loads apply in order once it loads or fails to", () => {
  const push: ClosedTabOp = { kind: "update", update: (stack: ClosedTab[]) => stack }
  const reopen: ClosedTabOp = { kind: "reopen", options: { append: true } }
  const remove: ClosedTabOp = { kind: "update", update: (stack: ClosedTab[]) => stack.slice(1) }

  const queued = replay([
    { type: "closed.op", op: push },
    { type: "closed.op", op: reopen },
    { type: "closed.op", op: remove },
  ])
  expect(queued.effects).toEqual([])

  // A failed load also settles `ready()`, and the store runs from its initial value.
  const loaded = replay([{ type: "closed.hydrated" }], queued.state)
  expect(loaded.effects).toEqual([{ type: "closed.apply", ops: [push, reopen, remove] }])

  expect(replay([{ type: "closed.op", op: reopen }], loaded.state).effects).toEqual([
    { type: "closed.apply", ops: [reopen] },
  ])
})

test("stores that load synchronously start ready", () => {
  const ready = createTabsHydrationState({ recent: true, closed: true })

  expect(replay([{ type: "recent.set", key: "tab-a", persistedKey: undefined }], ready).effects).toEqual([
    { type: "recent.commit", key: "tab-a" },
  ])
  expect(selectRecentTabKey(ready, "tab-old")).toBe("tab-old")
})

test("disposing drops queued operations", () => {
  const disposed = replay([
    { type: "closed.op", op: { kind: "reopen" } },
    { type: "recent.set", key: "tab-a", persistedKey: undefined },
    { type: "disposed" },
  ]).state

  expect(replay([{ type: "closed.hydrated" }, { type: "recent.hydrated", persistedKey: undefined }], disposed)).toEqual(
    { state: disposed, effects: [] },
  )
})
