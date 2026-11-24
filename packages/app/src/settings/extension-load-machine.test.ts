import { expect, test } from "bun:test"
import {
  createExtensionLoadState,
  EXTENSION_LOAD_TIMEOUT_MS,
  extensionLoadView,
  transitionExtensionLoad,
  type ExtensionLoadEffect,
  type ExtensionLoadEvent,
  type ExtensionLoadState,
} from "./extension-load-machine"

type State = ExtensionLoadState<string[], string>

type Event = ExtensionLoadEvent<string[], string>

function replay(events: Event[], state: State = createExtensionLoadState()) {
  return events.reduce<{ state: State; effects: ExtensionLoadEffect<string>[] }>(
    (current, event) => {
      const result = transitionExtensionLoad(current.state, event)

      return { state: result.state, effects: [...current.effects, ...result.effects] }
    },
    { state, effects: [] },
  )
}

const run = (attempt: number, key: string): ExtensionLoadEffect<string> => ({
  type: "run",
  attempt,
  key,
  timeoutMs: EXTENSION_LOAD_TIMEOUT_MS,
})

test("a failed list shows an error with Retry instead of an empty list", () => {
  const failed = replay([
    { type: "target.synced", key: "/a" },
    { type: "load.failed", attempt: 1 },
  ])

  expect(extensionLoadView(failed.state, "/a")).toEqual({ status: "error" })

  const timedOut = replay([
    { type: "target.synced", key: "/a" },
    { type: "load.timed-out", attempt: 1 },
  ])

  expect(extensionLoadView(timedOut.state, "/a")).toEqual({ status: "error" })
})

test("switching projects drops the previous project's list at once and ignores its late result", () => {
  const ready = replay([
    { type: "target.synced", key: "/a" },
    { type: "load.succeeded", attempt: 1, value: ["plugin-a"] },
  ]).state

  // The page renders the next project before the driver syncs its key.
  expect(extensionLoadView(ready, "/b")).toEqual({ status: "loading" })

  const switched = replay([{ type: "target.synced", key: "/b" }], ready)
  expect(switched.effects).toEqual([run(2, "/b")])
  expect(extensionLoadView(switched.state, "/b")).toEqual({ status: "loading" })

  const again = replay([{ type: "target.synced", key: "/a" }], switched.state)
  expect(again.effects).toEqual([{ type: "abort", attempt: 2 }, run(3, "/a")])
  expect(transitionExtensionLoad(again.state, { type: "load.succeeded", attempt: 2, value: ["plugin-b"] }).state).toBe(
    again.state,
  )
})

test("Retry reads once and shows loading while it runs", () => {
  const failed = replay([
    { type: "target.synced", key: "/a" },
    { type: "load.failed", attempt: 1 },
  ]).state

  const retried = replay([{ type: "retry.requested" }], failed)
  expect(retried.effects).toEqual([run(2, "/a")])
  expect(extensionLoadView(retried.state, "/a")).toEqual({ status: "loading" })
  expect(transitionExtensionLoad(retried.state, { type: "retry.requested" }).state).toBe(retried.state)

  const done = transitionExtensionLoad(retried.state, { type: "load.succeeded", attempt: 2, value: [] })
  expect(done.effects).toEqual([{ type: "abort", attempt: 2 }])
  expect(extensionLoadView(done.state, "/a")).toEqual({ status: "ready", value: [] })
})

test("a change during a read reads once more, and a failed refresh keeps the list", () => {
  const queued = replay([
    { type: "target.synced", key: "/a" },
    { type: "invalidated" },
    { type: "invalidated" },
    { type: "load.succeeded", attempt: 1, value: ["old"] },
  ])

  expect(queued.effects).toEqual([run(1, "/a"), { type: "abort", attempt: 1 }, run(2, "/a")])
  expect(extensionLoadView(queued.state, "/a")).toEqual({ status: "ready", value: ["old"] })

  const kept = transitionExtensionLoad(queued.state, { type: "load.timed-out", attempt: 2 }).state
  expect(extensionLoadView(kept, "/a")).toEqual({ status: "ready", value: ["old"] })

  // A reconnect reads a failed list again without Retry.
  const failed = replay([
    { type: "target.synced", key: "/a" },
    { type: "load.failed", attempt: 1 },
    { type: "invalidated" },
  ])

  expect(failed.effects.at(-1)).toEqual(run(2, "/a"))
})

test("closing the page aborts the running read and ignores its result", () => {
  const disposed = replay([{ type: "target.synced", key: "/a" }, { type: "disposed" }])

  expect(disposed.effects).toEqual([run(1, "/a"), { type: "abort", attempt: 1 }])
  expect(transitionExtensionLoad(disposed.state, { type: "load.succeeded", attempt: 1, value: [] }).state).toBe(
    disposed.state,
  )
})
